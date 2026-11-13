"use client";

import {
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ParticipantKind, Room, RoomEvent } from "livekit-client";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { learn, timeAgo } from "@/lib/client";
import { hostName, parseRepoLoose, repoIdOf } from "@/lib/parse";
import { MAX_REPOS, type Knowledge } from "@/lib/types";
import "./desk.css";

const CONCEPT_TOPIC = "repo-buddy.concept";
const CODE_TOPIC = "repo-buddy.code";

type Phase = "idle" | "connecting" | "live" | "ended";
type SideTab = "words" | "about" | "people";
type Ask = (q: string) => void;
interface Concept {
  term: string;
  explanation: string;
}
interface TypedMessage {
  id: string;
  text: string;
  at: number;
}
/** A file (or part of one) that Pixel put on screen. */
interface CodeView {
  repo: string;
  path: string;
  firstLine: number;
  totalLines: number;
  code: string;
  startLine: number | null;
  endLine: number | null;
  caption: string;
  url: string;
}

export default function Talk() {
  const params = useSearchParams();
  const wanted = useMemo(() => {
    const raw = (params.get("repos") ?? "").split(",");
    const parsed = raw.map((r) => parseRepoLoose(r)).filter((r): r is string => r !== null);
    return [...new Set(parsed)].slice(0, MAX_REPOS);
  }, [params]);

  const [repos, setRepos] = useState<Knowledge[]>([]);
  const [loadStep, setLoadStep] = useState("Opening my notes");
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (wanted.length === 0) {
        setLoadError("No repo was picked. Go back and paste a GitHub or GitLab link.");
        return;
      }
      try {
        const out: Knowledge[] = [];
        for (const full of wanted) {
          const { knowledge } = await learn(full, { onStep: (m) => !cancelled && setLoadStep(`${full}: ${m}`) });
          out.push(knowledge);
        }
        if (!cancelled) {
          setRepos(out);
          setLoaded(true);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load that repo.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  const room = useMemo(() => new Room({ dynacast: true }), []);
  useEffect(() => () => void room.disconnect(), [room]);

  if (loadError) {
    return (
      <main className="page narrow">
        <section className="card center">
          <h1>Hmm, that didn&apos;t work</h1>
          <p>{loadError}</p>
          <Link className="btn" href="/">Back to the start</Link>
        </section>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className="page narrow">
        <section className="card learning">
          <Image src="/avatar.png" alt="Pixel the fox" width={184} height={280} className="learning-fox bob" priority />
          <div className="learning-body">
            <h1>One moment…</h1>
            <p className="muted" aria-live="polite">{loadStep}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <RoomContext.Provider value={room}>
      <Session room={room} repos={repos} setRepos={setRepos} />
      <RoomAudioRenderer />
    </RoomContext.Provider>
  );
}

function Session({
  room,
  repos,
  setRepos,
}: {
  room: Room;
  repos: Knowledge[];
  setRepos: React.Dispatch<React.SetStateAction<Knowledge[]>>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [unseenWords, setUnseenWords] = useState(0);
  const [views, setViews] = useState<CodeView[]>([]);
  const [viewIndex, setViewIndex] = useState(0);
  const [typed, setTyped] = useState<TypedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<SideTab>("words");
  const [updateNote, setUpdateNote] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<SideTab>("words");
  tabRef.current = tab;

  const { state, videoTrack } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const transcriptions = useTranscriptions();
  const agentReady = phase === "live" && (state === "listening" || state === "thinking" || state === "speaking");

  // Concept cards and code views pushed by the agent's tools.
  useEffect(() => {
    room.registerTextStreamHandler(CONCEPT_TOPIC, async (reader) => {
      try {
        const c = JSON.parse(await reader.readAll()) as Concept;
        if (!c.term || !c.explanation) return;
        setConcepts((prev) => [c, ...prev.filter((x) => x.term.toLowerCase() !== c.term.toLowerCase())].slice(0, 12));
        if (tabRef.current !== "words") setUnseenWords((n) => n + 1);
      } catch {
        // Ignore a malformed card.
      }
    });
    room.registerTextStreamHandler(CODE_TOPIC, async (reader) => {
      try {
        const v = JSON.parse(await reader.readAll()) as CodeView;
        if (!v.path || typeof v.code !== "string") return;
        // Newest first; showing the same file again replaces its older entry.
        setViews((prev) => [v, ...prev.filter((x) => !(x.repo === v.repo && x.path === v.path))].slice(0, 6));
        setViewIndex(0);
      } catch {
        // Ignore a malformed view.
      }
    });
    const onDisconnected = () => setPhase((p) => (p === "idle" ? p : "ended"));
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.unregisterTextStreamHandler(CONCEPT_TOPIC);
      room.unregisterTextStreamHandler(CODE_TOPIC);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setTyped((prev) => [...prev, { id: crypto.randomUUID(), text: clean, at: Date.now() }]);
      try {
        await room.localParticipant.sendText(clean, { topic: "lk.chat" });
      } catch {
        setError("That message didn't go through. Try again.");
      }
    },
    [room],
  );

  const connect = useCallback(async () => {
    setError("");
    setSlow(false);
    setPhase("connecting");
    try {
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: repos.map((k) => repoIdOf(k)) }),
      });
      const data = (await res.json()) as { url?: string; token?: string; error?: string };
      if (!res.ok || !data.url || !data.token) throw new Error(data.error ?? "Couldn't start the session.");
      await room.connect(data.url, data.token);
      setPhase("live");
      // The mic is optional: a student can still type if they say no.
      room.localParticipant.setMicrophoneEnabled(true).catch(() => {
        setError("Your microphone is off, so Pixel can't hear you. You can still type your questions.");
      });
    } catch (e) {
      pending.current = null;
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Couldn't start the session.");
    }
  }, [repos, room]);

  // Reassure the student during a cold start, and give up if Pixel never arrives.
  useEffect(() => {
    if (phase === "idle" || phase === "ended" || agentReady) return;
    const slowTimer = setTimeout(() => setSlow(true), 7000);
    const giveUp = setTimeout(() => {
      pending.current = null;
      void room.disconnect();
      setPhase("idle");
      setError("Pixel didn't show up this time. Please try again in a moment.");
    }, 60_000);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(giveUp);
    };
  }, [phase, agentReady, room]);

  // A question tapped before the session started is asked once Pixel is listening.
  useEffect(() => {
    if (agentReady && state === "listening" && pending.current) {
      const q = pending.current;
      pending.current = null;
      void send(q);
    }
  }, [agentReady, state, send]);

  const ask: Ask = (q) => {
    if (phase === "live" && agentReady) void send(q);
    else {
      pending.current = q;
      if (phase === "idle" || phase === "ended") void connect();
    }
  };

  const hangUp = () => {
    pending.current = null;
    void room.disconnect();
    setPhase("ended");
  };

  const checkForUpdates = async (k: Knowledge) => {
    const full = repoIdOf(k);
    setChecking(full);
    setUpdateNote((n) => ({ ...n, [full]: `Checking ${hostName(k.host)}…` }));
    try {
      const result = await learn(full, {
        refresh: true,
        onStep: (m) => setUpdateNote((n) => ({ ...n, [full]: `${m}…` })),
      });
      if (!result.updated) {
        setUpdateNote((n) => ({ ...n, [full]: "Already up to date. Pixel knows the newest version." }));
      } else {
        setRepos((prev) => prev.map((x) => (repoIdOf(x) === full ? result.knowledge : x)));
        setUpdateNote((n) => ({ ...n, [full]: "Updated! Pixel just learned the latest changes." }));
        // Tell the live agent to reload its notes.
        const agent = [...room.remoteParticipants.values()].find(
          (p) => p.kind === ParticipantKind.AGENT && !p.attributes["lk.publish_on_behalf"],
        );
        if (agent && room.state === "connected") {
          await room.localParticipant
            .performRpc({ destinationIdentity: agent.identity, method: "refresh_knowledge", payload: JSON.stringify({ repo: full }) })
            .catch(() => {});
        }
      }
    } catch (e) {
      setUpdateNote((n) => ({ ...n, [full]: e instanceof Error ? e.message : "Couldn't check for updates." }));
    } finally {
      setChecking(null);
    }
  };

  const messages = useMemo(() => {
    const me = localParticipant.identity;
    const spoken = transcriptions
      .filter((t) => t.text.trim())
      .map((t) => ({
        id: t.streamInfo.id,
        text: t.text,
        at: t.streamInfo.timestamp,
        mine: t.participantInfo.identity === me,
      }));
    const written = typed.map((t) => ({ ...t, mine: true }));
    return [...spoken, ...written].sort((a, b) => a.at - b.at);
  }, [transcriptions, typed, localParticipant.identity]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const k = repos[Math.min(active, repos.length - 1)];
  const full = repoIdOf(k);
  const view = views[Math.min(viewIndex, views.length - 1)] as CodeView | undefined;

  const status =
    phase === "idle" ? "Ready when you are"
    : phase === "ended" ? "Session ended"
    : !agentReady ? (slow ? "Waking up… up to 20 seconds" : "Calling Pixel…")
    : state === "speaking" ? "Pixel is talking"
    : state === "thinking" ? "Pixel is thinking…"
    : isMicrophoneEnabled ? "Listening. Go ahead!"
    : "Mic is off. Type below.";

  const pickTab = (t: SideTab) => {
    setTab(t);
    if (t === "words") setUnseenWords(0);
  };

  return (
    <main className="desk">
      {/* ---------- Pixel ---------- */}
      <aside className="desk-col col-pixel">
        <section className="tile pixel-tile">
          <div className={`stage ${state === "speaking" && phase === "live" ? "speaking" : ""}`}>
            {phase === "live" && videoTrack ? (
              <VideoTrack trackRef={videoTrack} className="stage-video" />
            ) : (
              <Image
                src="/avatar.png"
                alt="Pixel the fox"
                width={368}
                height={560}
                priority
                className={`stage-still ${phase === "connecting" || (phase === "live" && !videoTrack) ? "bob" : ""}`}
              />
            )}
            <div className={`status ${phase}`} aria-live="polite">
              <span className="status-dot" aria-hidden />
              {status}
            </div>
          </div>

          <div className="controls">
            {phase === "idle" || phase === "ended" ? (
              <button className="btn" onClick={() => void connect()}>
                {phase === "ended" ? "Talk again" : "Start talking"}
              </button>
            ) : (
              <>
                <button
                  className={`btn ${isMicrophoneEnabled ? "" : "ghost"}`}
                  disabled={phase !== "live"}
                  onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => setError("I couldn't turn on your microphone. Check your browser's permission."))}
                >
                  {isMicrophoneEnabled ? "Mute" : "Unmute"}
                </button>
                <button className="btn ghost" onClick={hangUp}>End</button>
              </>
            )}
          </div>
          {error && <p className="form-error small" role="alert">{error}</p>}
        </section>

        <section className="tile grow">
          <h2 className="tile-title">Try asking</h2>
          <div className="tile-body chips-col">
            {k.questions.map((q) => (
              <button key={q} className="chip q" onClick={() => ask(q)}>{q}</button>
            ))}
            <button className="chip q" onClick={() => ask("Who are the most active contributors, and how active is this project?")}>Who is most active here?</button>
            <button className="chip q" onClick={() => ask("What changed most recently in this project?")}>What changed recently?</button>
          </div>
        </section>
      </aside>

      {/* ---------- Code + conversation ---------- */}
      <section className="desk-col col-main">
        <section className="tile code-tile">
          <div className="tile-bar">
            <h2 className="tile-title">Code window</h2>
            {views.length > 1 && (
              <div className="file-tabs" role="tablist" aria-label="Files Pixel has shown">
                {views.map((v, i) => (
                  <button key={`${v.repo}:${v.path}`} role="tab" aria-selected={i === viewIndex} className={`file-tab ${i === viewIndex ? "on" : ""}`} onClick={() => setViewIndex(i)} title={v.path}>
                    {v.path.split("/").pop()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="code-split">
            <nav className="explorer" aria-label="Files in this project">
              <p className="explorer-hint">Tap a file and Pixel will show and explain it.</p>
              <FileTree tree={k.tree} current={view && view.repo.toLowerCase() === full.toLowerCase() ? view.path : null} onPick={(p) => ask(`Show me the file ${p} and explain what it does.`)} />
            </nav>
            {view ? <CodePane view={view} /> : <ExploreGuide ask={ask} />}
          </div>
        </section>

        <section className="tile talk-tile">
          <h2 className="tile-title">Conversation</h2>
          <div className="tile-body log" ref={logRef}>
            {messages.length === 0 ? (
              <p className="muted small">What you and Pixel say shows up here.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`bubble ${m.mine ? "mine" : "pixel"}`}>
                  <span className="who">{m.mine ? "You" : "Pixel"}</span>
                  {m.text}
                </div>
              ))
            )}
          </div>
          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              ask(draft);
              setDraft("");
            }}
          >
            <input className="input" placeholder="Type a question for Pixel…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Type a question for Pixel" maxLength={400} />
            <button className="btn" type="submit" disabled={!draft.trim()}>Ask</button>
          </form>
        </section>
      </section>

      {/* ---------- Words / about / people ---------- */}
      <aside className="desk-col col-side">
        <section className="tile grow">
          {repos.length > 1 && (
            <div className="repo-tabs" role="tablist" aria-label="Repository">
              {repos.map((r, i) => (
                <button key={repoIdOf(r)} role="tab" aria-selected={i === active} className={`file-tab ${i === active ? "on" : ""}`} onClick={() => setActive(i)}>
                  {r.repo}
                </button>
              ))}
            </div>
          )}
          <div className="side-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "words"} className={`side-tab ${tab === "words" ? "on" : ""}`} onClick={() => pickTab("words")}>
              Words to know{unseenWords > 0 && <span className="badge">{unseenWords}</span>}
            </button>
            <button role="tab" aria-selected={tab === "about"} className={`side-tab ${tab === "about" ? "on" : ""}`} onClick={() => pickTab("about")}>About</button>
            <button role="tab" aria-selected={tab === "people"} className={`side-tab ${tab === "people" ? "on" : ""}`} onClick={() => pickTab("people")}>People</button>
          </div>

          <div className="tile-body">
            {tab === "words" && (
              <div className="words">
                <p className="muted small">New ideas Pixel explains land at the top. Tap a word to hear more.</p>
                {concepts.map((c) => (
                  <button key={`live-${c.term}`} className="word fresh" onClick={() => ask(`Can you explain ${c.term} again in a different way?`)}>
                    <strong>{c.term}</strong>
                    <span>{c.explanation}</span>
                  </button>
                ))}
                {k.glossary
                  .filter((g) => !concepts.some((c) => c.term.toLowerCase() === g.name.toLowerCase()))
                  .map((g) => (
                    <button key={g.name} className="word" onClick={() => ask(`What does ${g.name} mean in this project?`)}>
                      <strong>{g.name}</strong>
                      <span>{g.explanation}</span>
                    </button>
                  ))}
              </div>
            )}

            {tab === "about" && (
              <div className="about">
                <p className="eyebrow">{k.owner}/{k.repo} · on {hostName(k.host)}</p>
                <h1>{k.title}</h1>
                <p className="one-liner">{k.oneLiner}</p>
                <p>{k.summary}</p>
                {k.analogy && <p className="analogy"><strong>Think of it like this:</strong> {k.analogy}</p>}
                <div className="meta">
                  <span>Last changed: <strong>{k.commitDate ? new Date(k.commitDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "unknown"}</strong></span>
                  <span>Pixel learned it: <strong>{timeAgo(k.learnedAt)}</strong></span>
                  <span>{k.fileCount.toLocaleString("en-US")} files read{k.truncated ? " (big project, so the most important ones)" : ""}</span>
                </div>
                <div className="about-actions">
                  <button className="btn ghost" disabled={checking !== null} onClick={() => void checkForUpdates(k)}>
                    {checking === full ? "Checking…" : "Check for updates"}
                  </button>
                  <a className="btn ghost" href={k.url} target="_blank" rel="noreferrer">{hostName(k.host)} ↗</a>
                </div>
                {updateNote[full] && <p className="update-note" aria-live="polite">{updateNote[full]}</p>}
                {k.parts.length > 0 && (
                  <>
                    <h3>What&apos;s inside</h3>
                    <ul className="parts">
                      {k.parts.map((p) => (
                        <li key={p.name}>
                          <strong>{p.name}</strong>
                          {p.where && <code>{p.where}</code>}
                          <span>{p.explanation}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {k.tech.length > 0 && (
                  <>
                    <h3>Built with</h3>
                    <ul className="parts">
                      {k.tech.map((t) => (
                        <li key={t.name}><strong>{t.name}</strong><span>{t.explanation}</span></li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {tab === "people" &&
              (k.activity && k.activity.source !== "none" ? (
                <ActivityPanel k={k} ask={ask} />
              ) : (
                <p className="muted">Pixel couldn&apos;t load who works on this project. Try &quot;Check for updates&quot; on the About tab later.</p>
              ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

/* ---------- code window ---------- */

function CodePane({ view }: { view: CodeView }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => view.code.split("\n"), [view.code]);
  const hasRange = view.startLine !== null && view.endLine !== null;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const first = box.querySelector<HTMLElement>(".code-line.hl");
    box.scrollTop = first ? Math.max(0, first.offsetTop - 48) : 0;
  }, [view]);

  const folders = view.path.split("/");
  const file = folders.pop();
  const site = view.url.startsWith("https://gitlab.com/") ? "GitLab" : "GitHub";

  return (
    <div className="code-pane">
      <div className="code-head">
        <span className="crumbs">
          {folders.map((f, i) => (
            <span key={i} className="crumb">{f}<span aria-hidden> / </span></span>
          ))}
          <strong>{file}</strong>
        </span>
        <a href={view.url} target="_blank" rel="noreferrer" className="code-link">Open on {site} ↗</a>
      </div>
      {view.caption && (
        <p className="code-caption">
          <strong>{hasRange ? `Lines ${view.startLine}${view.endLine !== view.startLine ? `–${view.endLine}` : ""}: ` : ""}</strong>
          {view.caption}
        </p>
      )}
      <div className="code-box" ref={boxRef} tabIndex={0} aria-label={`Contents of ${view.path}`}>
        {lines.map((text, i) => {
          const n = view.firstLine + i;
          const hl = hasRange && n >= (view.startLine as number) && n <= (view.endLine as number);
          return (
            <div key={n} className={`code-line ${hl ? "hl" : ""}`}>
              <span className="ln">{n}</span>
              <span className="lt">{text || " "}</span>
            </div>
          );
        })}
        {view.firstLine + lines.length - 1 < view.totalLines && (
          <p className="code-more">This file keeps going. Open it on {site} to see all {view.totalLines.toLocaleString("en-US")} lines.</p>
        )}
      </div>
    </div>
  );
}

function ExploreGuide({ ask }: { ask: Ask }) {
  return (
    <div className="guide">
      <h3>How to find your way around a codebase</h3>
      <ol>
        <li><strong>Start with the README.</strong> It&apos;s the project&apos;s welcome page: what it is and how to use it.</li>
        <li><strong>Read the folder names.</strong> They&apos;re like labels on drawers. They tell you where each kind of thing lives.</li>
        <li><strong>Find the starting point.</strong> Most projects have one file where everything begins.</li>
        <li><strong>Follow one feature.</strong> Pick one thing the project does and trace it from file to file.</li>
      </ol>
      <p className="muted small">When Pixel talks about code, the file appears right here with the important lines highlighted.</p>
      <div className="chips">
        <button className="chip q" onClick={() => ask("Show me the README and tell me what it says.")}>Show me the README</button>
        <button className="chip q" onClick={() => ask("Where does this project start running? Show me that file.")}>Where does it start?</button>
        <button className="chip q" onClick={() => ask("Give me a tour of the folders and what each one is for.")}>Tour the folders</button>
      </div>
    </div>
  );
}

interface TreeNode {
  folders: Map<string, TreeNode>;
  files: { name: string; path: string }[];
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.folders.get(parts[i]);
      if (!next) {
        next = { folders: new Map(), files: [] };
        node.folders.set(parts[i], next);
      }
      node = next;
    }
    node.files.push({ name: parts[parts.length - 1], path });
  }
  return root;
}

function FileTree({ tree, current, onPick }: { tree: string[]; current: string | null; onPick: (path: string) => void }) {
  const root = useMemo(() => buildTree(tree), [tree]);
  return <TreeLevel node={root} prefix="" current={current} onPick={onPick} />;
}

const MAX_SHOWN = 150;

function TreeLevel({ node, prefix, current, onPick }: { node: TreeNode; prefix: string; current: string | null; onPick: (path: string) => void }) {
  const folders = [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className="tree">
      {folders.slice(0, MAX_SHOWN).map(([name, child]) => (
        <TreeFolder key={name} name={name} node={child} path={`${prefix}${name}/`} current={current} onPick={onPick} />
      ))}
      {files.slice(0, MAX_SHOWN).map((f) => (
        <li key={f.path}>
          <button className={`tree-file ${current === f.path ? "on" : ""}`} onClick={() => onPick(f.path)} title={f.path}>
            {f.name}
          </button>
        </li>
      ))}
      {folders.length + files.length > MAX_SHOWN * 2 && <li className="tree-more">…and more in the full project</li>}
    </ul>
  );
}

function TreeFolder({ name, node, path, current, onPick }: { name: string; node: TreeNode; path: string; current: string | null; onPick: (path: string) => void }) {
  const holdsCurrent = current !== null && current.startsWith(path);
  const [open, setOpen] = useState(false);
  const isOpen = open || holdsCurrent;
  return (
    <li>
      <button className="tree-folder" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <span className="tree-arrow" aria-hidden>{isOpen ? "▾" : "▸"}</span>
        {name}
      </button>
      {isOpen && <TreeLevel node={node} prefix={path} current={current} onPick={onPick} />}
    </li>
  );
}

/* ---------- people ---------- */

const LEVEL_TEXT: Record<string, string> = {
  "very active": "Very active: changes almost every day",
  active: "Active: people work on it regularly",
  quiet: "Quiet: a few changes in the last three months",
  slow: "Slow: no changes in the last three months",
  dormant: "Sleeping: no changes in over a year",
  unknown: "Activity unknown",
};

function ActivityPanel({ k, ask }: { k: Knowledge; ask: Ask }) {
  const a = k.activity;
  if (!a) return null;
  const top = a.contributors.slice(0, 6);
  const max = Math.max(1, ...top.map((c) => c.contributions));
  const plus = (n: number, capped: boolean) => `${n.toLocaleString("en-US")}${capped ? "+" : ""}`;
  const stats: [string, string][] = [];
  if (a.contributorCount !== null) stats.push([plus(a.contributorCount, a.contributorCountCapped), "people contributed"]);
  stats.push([plus(a.last30, a.last30Capped), "changes, last 30 days"]);
  stats.push([plus(a.last90, a.last90Capped), "changes, last 90 days"]);
  if (a.stars !== null) stats.push([a.stars.toLocaleString("en-US"), "stars (bookmarks)"]);

  return (
    <div className="people">
      <p className={`level level-${a.level.replace(" ", "-")}`}>{LEVEL_TEXT[a.level]}</p>
      <div className="stats">
        {stats.map(([n, label]) => (
          <div key={label} className="stat"><strong>{n}</strong><span>{label}</span></div>
        ))}
      </div>
      {k.recentChanges && <p><strong>Lately:</strong> {k.recentChanges}</p>}

      {top.length > 0 && (
        <>
          <h3>Top contributors of all time</h3>
          <p className="muted small">A <strong>commit</strong> is one saved change to the code.</p>
          <ul className="bars">
            {top.map((c) => (
              <li key={c.login}>
                <button className="bar-name" onClick={() => ask(`What has ${c.login} worked on in this project?`)}>{c.login}</button>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(4, (c.contributions / max) * 100)}%` }} /></span>
                <span className="bar-num">{c.contributions.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {a.topRecent.length > 0 && (
        <p>
          <strong>Most active recently:</strong>{" "}
          {a.topRecent.slice(0, 4).map((p) => `${p.login} (${p.commits})`).join(", ")}
          <span className="muted small"> in the latest {a.window} changes</span>
        </p>
      )}

      {a.recentCommits.length > 0 && (
        <details className="commits">
          <summary>Latest changes</summary>
          <ul>
            {a.recentCommits.slice(0, 10).map((c) => (
              <li key={c.sha}>
                <span className="commit-date">{new Date(c.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                <span><strong>{c.login}</strong>: {c.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
