"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { learn, timeAgo } from "@/lib/client";
import { parseRepoLoose, repoIdOf } from "@/lib/parse";
import { TUTORIAL_HREF } from "@/lib/tutorial";
import { MAX_REPOS, type RecentRepo } from "@/lib/types";

const EXAMPLES = ["pallets/flask", "expressjs/express", "psf/requests"];

interface Job {
  label: string;
  steps: string[];
  status: "waiting" | "working" | "done" | "error";
  error?: string;
}

export default function Home() {
  const router = useRouter();
  const [links, setLinks] = useState<string[]>([""]);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [formError, setFormError] = useState("");
  const [recent, setRecent] = useState<RecentRepo[]>([]);

  useEffect(() => {
    fetch("/api/repos/recent")
      .then((r) => r.json())
      .then((d: { repos?: RecentRepo[] }) => setRecent(d.repos ?? []))
      .catch(() => {});
  }, []);

  const setLink = (i: number, v: string) => setLinks((prev) => prev.map((x, j) => (j === i ? v : x)));
  const busy = jobs !== null && jobs.some((j) => j.status === "waiting" || j.status === "working");

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    const filled = links.map((l) => l.trim()).filter(Boolean);
    if (filled.length === 0) {
      setFormError("Paste a GitHub or GitLab link first, or tap one of the examples.");
      return;
    }
    const bad = filled.find((l) => !parseRepoLoose(l));
    if (bad) {
      setFormError(`"${bad}" doesn't look like a GitHub or GitLab repo link. It should look like github.com/owner/project.`);
      return;
    }
    const unique = [...new Set(filled.map((l) => parseRepoLoose(l) as string))];
    setFormError("");
    setJobs(unique.map((label) => ({ label, steps: [], status: "waiting" })));

    const patch = (i: number, fn: (j: Job) => Job) =>
      setJobs((prev) => (prev ? prev.map((j, k) => (k === i ? fn(j) : j)) : prev));

    const learned: string[] = [];
    let failed = false;
    for (let i = 0; i < unique.length; i++) {
      patch(i, (j) => ({ ...j, status: "working" }));
      try {
        const { knowledge } = await learn(unique[i], {
          onStep: (m) => patch(i, (j) => ({ ...j, steps: [...j.steps, m] })),
        });
        learned.push(repoIdOf(knowledge));
        patch(i, (j) => ({ ...j, status: "done" }));
      } catch (err) {
        failed = true;
        patch(i, (j) => ({ ...j, status: "error", error: err instanceof Error ? err.message : "Failed" }));
      }
    }
    if (!failed && learned.length) router.push(`/talk?repos=${encodeURIComponent(learned.join(","))}`);
  }

  if (jobs) {
    return (
      <main className="page narrow">
        <section className="card learning">
          <Image src="/avatar.png" alt="Pixel the fox" width={184} height={280} className={`learning-fox ${busy ? "bob" : ""}`} priority />
          <div className="learning-body">
            <h1>{busy ? "Pixel is reading the code…" : "Hmm, I hit a snag"}</h1>
            <p className="muted">
              The first time takes up to a minute. After that, Pixel remembers the repo and it opens instantly.
            </p>
            <ul className="jobs" aria-live="polite">
              {jobs.map((j) => (
                <li key={j.label} className={`job ${j.status}`}>
                  <div className="job-head">
                    <span className="job-dot" aria-hidden />
                    <strong>{j.label}</strong>
                    <span className="job-state">
                      {j.status === "waiting" && "Up next"}
                      {j.status === "working" && (j.steps[j.steps.length - 1] ?? "Looking in my memory")}
                      {j.status === "done" && "Got it!"}
                      {j.status === "error" && "Couldn't learn this one"}
                    </span>
                  </div>
                  {j.error && <p className="job-error">{j.error}</p>}
                </li>
              ))}
            </ul>
            {!busy && (
              <button className="btn" onClick={() => setJobs(null)}>
                Go back and fix the links
              </button>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-fox">
          <Image src="/avatar.png" alt="Pixel, a cartoon fox in a red hoodie" width={368} height={560} priority />
          <div className="speech">Hey there! I&apos;m Pixel. Show me some code and I&apos;ll explain it.</div>
        </div>

        <div className="hero-main">
          <p className="eyebrow">For Lville students · Go Big Red</p>
          <h1>
            Ever wondered how real apps are <em>actually</em> built?
          </h1>
          <p className="lead">
            Paste a link to any public project on GitHub or GitLab. Pixel reads all the code, then you can talk out loud
            and ask anything. No coding experience needed.
          </p>

          <div className="card tour-card">
            <div>
              <strong>First time here?</strong> Take the 5-minute guided tour with a sample project.
            </div>
            <a className="btn" href={TUTORIAL_HREF}>Start the tour</a>
          </div>

          <form className="card form" onSubmit={start}>
            <label className="form-label" htmlFor="repo-0">
              GitHub or GitLab project link{links.length > 1 ? "s" : ""}
            </label>
            {links.map((l, i) => (
              <div className="row" key={i}>
                <input
                  id={`repo-${i}`}
                  className="input"
                  placeholder="https://github.com/owner/project"
                  value={l}
                  onChange={(e) => setLink(i, e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                />
                {links.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove link ${i + 1}`}
                    onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {links.length < MAX_REPOS && (
              <button type="button" className="link-btn" onClick={() => setLinks((p) => [...p, ""])}>
                + Add another repo to compare
              </button>
            )}
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="btn big" type="submit">
              Teach Pixel this code
            </button>
            <p className="examples">
              <span>No link handy? Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  type="button"
                  key={ex}
                  className="chip"
                  onClick={() => {
                    setFormError("");
                    setLinks((prev) => {
                      const empty = prev.findIndex((x) => !x.trim());
                      if (empty >= 0) return prev.map((x, j) => (j === empty ? ex : x));
                      return prev.length < MAX_REPOS ? [...prev, ex] : prev;
                    });
                  }}
                >
                  {ex}
                </button>
              ))}
            </p>
          </form>

          <details className="what">
            <summary>What&apos;s a &quot;repo&quot;, anyway?</summary>
            <p>
              A <strong>repo</strong> (short for repository) is a folder that holds all the files for a software
              project, plus a history of every change anyone made. <strong>GitHub</strong> and <strong>GitLab</strong> are websites where
              people share repos, a bit like a giant library for code.
            </p>
          </details>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="recent">
          <h2>Pixel already knows these</h2>
          <p className="muted">These open instantly. Tap one to start talking.</p>
          <div className="recent-grid">
            {recent.map((r) => (
              <a
                key={repoIdOf(r)}
                className="card recent-card"
                href={`/talk?repos=${encodeURIComponent(repoIdOf(r))}`}
              >
                <strong>{r.repo}</strong>
                <span className="recent-owner">by {r.owner}</span>
                <p>{r.oneLiner}</p>
                <span className="recent-when">Learned {timeAgo(r.learnedAt)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="how">
        <div className="card how-card"><span className="num">1</span><h3>Paste a link</h3><p>Any public GitHub or GitLab project. Add up to four to compare them.</p></div>
        <div className="card how-card"><span className="num">2</span><h3>Pixel reads it</h3><p>Every file, in about a minute. Pixel remembers it for next time.</p></div>
        <div className="card how-card"><span className="num">3</span><h3>Just ask</h3><p>Talk or type. Pixel explains new words as they come up.</p></div>
      </section>
    </main>
  );
}
