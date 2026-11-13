import type { IncomingMessage } from "node:http";
import https from "node:https";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import { hostName, parseRepoLoose, splitRepoId } from "./parse";
import type { RepoRef } from "./types";

/** Accepts GitHub and GitLab links and repo ids. Returns null if it is not a repo link. */
export function parseRepo(input: string): RepoRef | null {
  const id = parseRepoLoose(input);
  return id ? splitRepoId(id) : null;
}

/** The project's home page on its host. */
export function webUrl(r: RepoRef): string {
  return `https://${r.host === "gitlab" ? "gitlab.com" : "github.com"}/${r.owner}/${r.repo}`;
}

export class RepoError extends Error {}

/**
 * Latest commit on the default branch, read through git's own HTTP protocol.
 * Works the same on GitHub and GitLab, and avoids GitHub's 60 requests/hour anonymous API limit.
 */
export async function getHead(r: RepoRef): Promise<{ sha: string; branch: string }> {
  const res = await fetch(
    `${webUrl(r)}.git/info/refs?service=git-upload-pack`,
    { headers: { "User-Agent": "git/2.45.0" }, cache: "no-store" },
  );
  if (res.status === 401 || res.status === 404) {
    throw new RepoError(
      `I couldn't find ${r.owner}/${r.repo}. Check the link, and make sure the repo is public.`,
    );
  }
  if (!res.ok) throw new RepoError(`${hostName(r.host)} answered with an error (${res.status}). Try again in a minute.`);
  const text = await res.text();
  const sha = text.match(/([0-9a-f]{40}) HEAD/)?.[1];
  if (!sha) throw new RepoError(`${r.owner}/${r.repo} looks empty, so there is nothing to learn yet.`);
  const branch = text.match(/symref=HEAD:refs\/heads\/([^\s\0]+)/)?.[1] ?? "main";
  return { sha, branch };
}

export interface Download {
  files: Record<string, string>;
  tree: string[];
  totalPaths: number;
  truncated: boolean;
  commitDate: string | null;
}

const SKIP_DIRS = new Set([
  "node_modules", "vendor", "dist", "build", "out", "target", ".git", ".next", ".nuxt",
  "__pycache__", ".venv", "venv", "env", ".idea", ".vscode", "coverage", "bower_components",
  "Pods", ".gradle", "DerivedData", ".cache", "third_party", "site-packages",
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|uv\.lock|\.DS_Store)$/;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|icns|svg|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|exe|dll|so|dylib|a|o|obj|bin|dat|db|sqlite3?|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|flac|mov|avi|mkv|webm|psd|ai|sketch|fig|glb|gltf|fbx|blend|stl|npy|npz|pkl|pt|pth|onnx|h5|parquet|wasm|pyc|map|min\.js|min\.css|ipynb)$/i;

const MAX_FILE_BYTES = 100_000;
const MAX_CANDIDATE_BYTES = 14_000_000;
const MAX_KEEP_BYTES = 4_000_000;
const MAX_KEEP_FILES = 1500;
const MAX_TREE = 4000;
const MAX_DOWNLOAD_BYTES = 250_000_000;

/** Higher = more useful for understanding the project. Used when a repo is too big to keep whole. */
export function scorePath(p: string): number {
  const lower = p.toLowerCase();
  const depth = p.split("/").length - 1;
  const base = lower.split("/").pop() ?? lower;
  let s = 100 - depth * 8;
  if (/^readme(\.|$)/.test(base)) s += depth === 0 ? 200 : 40;
  if (depth === 0) s += 30;
  if (/^(package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|gemfile|composer\.json|makefile|dockerfile|setup\.py|cmakelists\.txt)$/.test(base)) s += 80;
  if (/^(main|index|app|server|cli|__main__|manage|program|lib|mod)\./.test(base)) s += 40;
  if (/(^|\/)(src|lib|app|core|pkg|cmd|server|client|api|components|pages|routes|models)\//.test(lower)) s += 20;
  if (/(^|\/)(tests?|__tests__|spec|fixtures?|examples?|samples?|docs?|benchmarks?|migrations|locales?|i18n|\.github)\//.test(lower)) s -= 45;
  if (/\.(test|spec)\.|_test\.|(^|\/)test_/.test(lower)) s -= 45;
  if (/\.(json|ya?ml|toml|csv|tsv|txt|xml|lock|snap)$/.test(base)) s -= 20;
  if (/\.(md|rst)$/.test(base)) s -= 5;
  return s;
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Plain HTTPS download that follows redirects. The built-in fetch is not used here because GitLab's
 * hotlink protection rejects archive requests that carry fetch's browser-style headers (HTTP 406).
 */
function openDownload(url: string, hops = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "repo-learning-tool", Accept: "*/*" } }, (res) => {
      const next = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && next && hops < 5) {
        res.resume();
        const target = new URL(next, url);
        if (target.protocol !== "https:") return reject(new Error("Refusing a non-HTTPS redirect"));
        resolve(openDownload(target.toString(), hops + 1));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("Download timed out")));
  });
}

/** Download the repo at an exact commit and keep the readable source files. */
export async function downloadRepo(r: RepoRef, sha: string): Promise<Download> {
  const archive =
    r.host === "gitlab"
      ? `${webUrl(r)}/-/archive/${sha}/${r.repo}-${sha}.tar.gz`
      : `https://codeload.github.com/${r.owner}/${r.repo}/tar.gz/${sha}`;
  const source = await openDownload(archive);
  if (source.statusCode !== 200) {
    source.destroy();
    throw new RepoError(`I couldn't download ${r.owner}/${r.repo} (${source.statusCode}).`);
  }

  const candidates: { path: string; text: string; bytes: number }[] = [];
  const tree: string[] = [];
  let totalPaths = 0;
  let candidateBytes = 0;
  let downloaded = 0;
  let truncated = false;
  let commitDate: string | null = null;

  const extract = tar.extract();
  const gunzip = createGunzip();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    const stopEarly = () => {
      truncated = true;
      source.destroy();
      finish();
    };

    source.on("data", (chunk: Buffer) => {
      downloaded += chunk.length;
      if (downloaded > MAX_DOWNLOAD_BYTES) stopEarly();
    });

    extract.on("entry", (header, stream, next) => {
      const path = header.name.split("/").slice(1).join("/");
      if (!commitDate && header.mtime) commitDate = header.mtime.toISOString();
      const parts = path.split("/");
      const skip =
        header.type !== "file" || !path || parts.some((seg) => SKIP_DIRS.has(seg));

      if (skip) {
        stream.resume();
        stream.on("end", next);
        return;
      }

      totalPaths++;
      if (tree.length < MAX_TREE) tree.push(path);
      else truncated = true;

      const size = header.size ?? 0;
      const wanted =
        size > 0 &&
        size <= MAX_FILE_BYTES &&
        !BINARY_EXT.test(path) &&
        !SKIP_FILES.test(path) &&
        candidateBytes + size <= MAX_CANDIDATE_BYTES;

      if (!wanted) {
        if (size > 0 && candidateBytes + size > MAX_CANDIDATE_BYTES) truncated = true;
        stream.resume();
        stream.on("end", next);
        return;
      }

      const chunks: Buffer[] = [];
      stream.on("data", (c: unknown) => void chunks.push(c as Buffer));
      stream.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (!looksBinary(buf)) {
          candidates.push({ path, text: buf.toString("utf8"), bytes: buf.length });
          candidateBytes += buf.length;
        }
        next();
      });
    });
    extract.on("finish", () => finish());
    extract.on("error", (e) => (settled ? undefined : finish(e)));
    gunzip.on("error", (e) => (settled ? undefined : finish(e)));
    source.on("error", (e) => (settled ? undefined : finish(e)));
    source.pipe(gunzip).pipe(extract);
  });

  // Too big to keep everything: keep the files most useful for understanding the project.
  candidates.sort((a, b) => scorePath(b.path) - scorePath(a.path) || a.path.localeCompare(b.path));
  const files: Record<string, string> = {};
  let kept = 0;
  let keptBytes = 0;
  for (const c of candidates) {
    if (kept >= MAX_KEEP_FILES || keptBytes + c.bytes > MAX_KEEP_BYTES) {
      truncated = true;
      continue;
    }
    files[c.path] = c.text;
    kept++;
    keptBytes += c.bytes;
  }

  tree.sort();
  return { files, tree, totalPaths, truncated, commitDate };
}
