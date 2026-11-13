import type { Knowledge, ProgressEvent } from "./types";

export interface LearnOutcome {
  knowledge: Knowledge;
  cached: boolean;
  updated: boolean;
}

/** Calls /api/repos and reports progress steps as they stream in. Throws with a student-friendly message. */
export async function learn(
  url: string,
  opts: { refresh?: boolean; onStep?: (message: string) => void } = {},
): Promise<LearnOutcome> {
  const res = await fetch("/api/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, refresh: Boolean(opts.refresh) }),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Something went wrong. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: LearnOutcome | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line) as ProgressEvent;
    if (ev.type === "step") opts.onStep?.(ev.message);
    else if (ev.type === "error") throw new Error(ev.message);
    else outcome = { knowledge: ev.knowledge, cached: ev.cached, updated: ev.updated };
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);

  if (!outcome) throw new Error("The connection dropped while I was learning. Please try again.");
  return outcome;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
