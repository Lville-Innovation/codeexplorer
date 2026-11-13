import { repoIdOf } from "./parse";
import type { Knowledge, RecentRepo, RepoRef } from "./types";

const PREFIX = "talktocodingrepo";

function base(): string {
  const zone = process.env.BUNNYCDN_STORAGE_ZONE_NAME;
  if (!zone || !process.env.BUNNYCDN_ACCESS_KEY) throw new Error("BunnyCDN storage is not configured");
  const region = (process.env.BUNNYCDN_REGION ?? "").toLowerCase();
  const host = !region || region === "de" ? "storage.bunnycdn.com" : `${region}.storage.bunnycdn.com`;
  return `https://${host}/${zone}/${PREFIX}`;
}

function headers(): Record<string, string> {
  return { AccessKey: process.env.BUNNYCDN_ACCESS_KEY as string };
}

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${base()}/${path}`, { headers: headers(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storage read failed (${res.status}) for ${path}`);
  return (await res.json()) as T;
}

async function putJson(path: string, value: unknown): Promise<void> {
  const res = await fetch(`${base()}/${path}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Storage write failed (${res.status}) for ${path}`);
}

/** Repo names are case-insensitive on both hosts, so the cache key is lower-cased. */
function dir(r: RepoRef): string {
  const flat = `${r.owner}/${r.repo}`.toLowerCase().split("/").join("__");
  return r.host === "gitlab" ? `repos/gitlab/${flat}` : `repos/${flat}`;
}

export function getKnowledge(r: RepoRef): Promise<Knowledge | null> {
  return getJson<Knowledge>(`${dir(r)}/knowledge.json`);
}

export async function saveRepo(k: Knowledge, files: Record<string, string>): Promise<void> {
  // Files first, so knowledge.json never points at files that are not there yet.
  await putJson(`${dir(k)}/files.json`, { sha: k.sha, files });
  await putJson(`${dir(k)}/knowledge.json`, k);

  const recent = (await getRecent()).filter(
    (x) => repoIdOf(x).toLowerCase() !== repoIdOf(k).toLowerCase(),
  );
  recent.unshift({ host: k.host, owner: k.owner, repo: k.repo, oneLiner: k.oneLiner, learnedAt: k.learnedAt });
  await putJson("index.json", recent.slice(0, 24));
}

export async function getRecent(): Promise<RecentRepo[]> {
  return (await getJson<RecentRepo[]>("index.json")) ?? [];
}
