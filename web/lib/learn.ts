import OpenAI from "openai";
import { getActivity } from "./activity";
import { downloadRepo, getHead, scorePath, webUrl } from "./github";
import { hostName } from "./parse";
import { getKnowledge, saveRepo } from "./store";
import { KNOWLEDGE_VERSION, type Activity, type Explained, type Knowledge, type RepoPart, type RepoRef } from "./types";

const MODEL = process.env.LEARN_MODEL || "anthropic/claude-sonnet-5.5";

const SYSTEM = `You help high school students with no programming background understand a software project hosted on GitHub or GitLab.
You will get the project's file list and the contents of its most important files.
Write for a curious 15 year old: plain words, short sentences, friendly, never condescending. Explain any technical word you use.
Only say things the files support. If the project is tiny or unclear, say so honestly.

Reply with only one JSON object (no markdown fences, no text before or after) with exactly these keys:
- "title": a short human name for the project (not just the repo slug unless that is its name)
- "oneLiner": one sentence, max 20 words, saying what it is
- "summary": 3 to 5 sentences on what the project does, who would use it, and roughly how it works
- "analogy": 1 or 2 sentences comparing the project to something from everyday teenage life
- "parts": 3 to 7 items {"name", "where", "explanation"}; the main building blocks, "where" is the real folder or file path, "explanation" is one or two plain sentences
- "tech": 2 to 8 items {"name", "explanation"}; languages, frameworks and tools the project really uses, each explained in one sentence a beginner would get
- "glossary": 6 to 12 items {"name", "explanation"}; technical words a student will run into when exploring THIS project, each defined in one simple sentence
- "recentChanges": 2 or 3 plain sentences describing what people have been working on lately, based on the recent commit messages (say so honestly if there is no commit information or nothing has changed in a long time)
- "questions": exactly 8 short questions (max 12 words each) a curious student might ask about THIS project, written in the student's voice, mixing big-picture ("What does this project do?" style but specific), how-it-works, and "where is the code that..." questions. Make one of them about who builds the project or how active it is`;

type Emit = (message: string) => void;

function activityText(a: Activity): string {
  if (a.source === "none") return "No commit history could be fetched.";
  return [
    `Activity level: ${a.level}. Last commit: ${a.lastCommitDate ?? "unknown"}.`,
    `Top contributors (all time): ${a.contributors.slice(0, 8).map((c) => `${c.login} (${c.contributions})`).join(", ") || "unknown"}`,
    "Recent commits (newest first):",
    ...a.recentCommits.slice(0, 30).map((c) => `- ${c.date.slice(0, 10)} ${c.login}: ${c.message}`),
  ].join("\n");
}

function buildPrompt(r: RepoRef, tree: string[], files: Record<string, string>, activity: Activity): string {
  const ranked = Object.keys(files).sort((a, b) => scorePath(b) - scorePath(a));
  let budget = 110_000;
  const chunks: string[] = [];
  for (const path of ranked) {
    if (budget <= 0) break;
    const isReadme = /(^|\/)readme(\.|$)/i.test(path);
    const text = files[path].slice(0, isReadme ? 14_000 : 6_000);
    if (text.length > budget) continue;
    chunks.push(`===== FILE: ${path} =====\n${text}`);
    budget -= text.length;
  }
  const shownTree = tree.slice(0, 700);
  return [
    `Repository: ${r.owner}/${r.repo}`,
    `File list (${tree.length} files${tree.length > shownTree.length ? `, first ${shownTree.length} shown` : ""}):`,
    shownTree.join("\n"),
    "",
    "Project activity:",
    activityText(activity),
    "",
    "Important files:",
    chunks.join("\n\n"),
  ].join("\n");
}

function asList<T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (x && typeof x === "object" ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null);
}
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);

async function summarize(r: RepoRef, tree: string[], files: Record<string, string>, activity: Activity) {
  // OpenRouter speaks the OpenAI chat API, so the OpenAI SDK works with a different base URL.
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildPrompt(r, tree, files, activity) },
    ],
  });
  const text = res.choices[0]?.message?.content ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return notes in the expected format");
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const explained = (x: Record<string, unknown>): Explained | null => {
    const name = str(x.name) || str(x.term);
    const explanation = str(x.explanation);
    return name && explanation ? { name, explanation } : null;
  };
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map((q) => str(q)).filter(Boolean).slice(0, 8)
    : [];
  return {
    title: str(raw.title, r.repo),
    oneLiner: str(raw.oneLiner, `The ${r.repo} project by ${r.owner}.`),
    summary: str(raw.summary),
    analogy: str(raw.analogy),
    parts: asList<RepoPart>(raw.parts, (x) => {
      const name = str(x.name);
      const explanation = str(x.explanation);
      return name && explanation ? { name, where: str(x.where), explanation } : null;
    }),
    tech: asList<Explained>(raw.tech, explained),
    glossary: asList<Explained>(raw.glossary, explained),
    recentChanges: str(raw.recentChanges),
    questions: questions.length
      ? questions
      : ["What does this project do?", "How is the code organized?", "Where should I start reading?"],
  };
}

export interface LearnResult {
  knowledge: Knowledge;
  cached: boolean;
  updated: boolean;
}

/**
 * Load a repo from cache, or learn it. With `checkForUpdates`, the cached copy is compared
 * against the latest commit on its host and re-learned if the repo has changed.
 */
export async function learnRepo(
  r: RepoRef,
  opts: { checkForUpdates: boolean },
  emit: Emit = () => {},
): Promise<LearnResult> {
  const cachedCopy = await getKnowledge(r);
  // A copy saved by an older version of this app is missing newer fields, so it is learned again.
  const current = cachedCopy && (cachedCopy.version ?? 1) >= KNOWLEDGE_VERSION;
  const existing = current ? cachedCopy : null;
  if (existing && !opts.checkForUpdates) return { knowledge: existing, cached: true, updated: false };

  const where = hostName(r.host);
  emit(existing ? `Checking ${where} for new changes` : `Finding ${r.owner}/${r.repo} on ${where}`);
  const head = await getHead(r);
  if (existing && existing.sha === head.sha) return { knowledge: existing, cached: true, updated: false };

  emit(existing ? "Found new changes, downloading them" : "Downloading the code");
  const dl = await downloadRepo(r, head.sha);
  const fileCount = Object.keys(dl.files).length;
  if (fileCount === 0) throw new Error(`${r.owner}/${r.repo} has no readable code files for me to learn from.`);

  emit("Looking at who works on it and how often");
  const activity = await getActivity(r);

  emit(`Reading ${fileCount.toLocaleString("en-US")} files`);
  const notes = await summarize(r, dl.tree, dl.files, activity);

  emit("Writing my notes so next time is instant");
  const knowledge: Knowledge = {
    version: KNOWLEDGE_VERSION,
    host: r.host ?? "github",
    owner: cachedCopy?.owner ?? r.owner,
    repo: cachedCopy?.repo ?? r.repo,
    url: webUrl(r),
    sha: head.sha,
    defaultBranch: head.branch,
    commitDate: dl.commitDate,
    learnedAt: new Date().toISOString(),
    fileCount,
    totalPaths: dl.totalPaths,
    truncated: dl.truncated,
    ...notes,
    activity,
    tree: dl.tree,
  };
  await saveRepo(knowledge, dl.files);
  return { knowledge, cached: false, updated: Boolean(existing) };
}
