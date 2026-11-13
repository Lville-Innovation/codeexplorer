// Browser-safe repo link parsing (lib/github.ts pulls in Node-only modules).
//
// A repo id is the short string used in page addresses, the cache and the agent:
//   GitHub:  "owner/repo"
//   GitLab:  "gitlab:group/subgroup/project"  (GitLab allows nested groups)
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,98}$/;
const MAX_GITLAB_DEPTH = 8;

function gitlabId(path: string): string | null {
  // Drop "/-/tree/main/..." style suffixes, query strings and a trailing ".git".
  const clean = path.split(/[?#]/)[0].split("/-/")[0].replace(/\/+$/, "").replace(/\.git$/i, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2 || parts.length > MAX_GITLAB_DEPTH) return null;
  if (!parts.every((p) => NAME.test(p))) return null;
  return `gitlab:${parts.join("/")}`;
}

/** Returns a repo id, or null. Accepts GitHub and GitLab URLs, "owner/repo", and repo ids. */
export function parseRepoLoose(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^gitlab:/i.test(s)) return gitlabId(s.slice("gitlab:".length));
  s = s.replace(/^git@github\.com:/i, "github.com/").replace(/^git@gitlab\.com:/i, "gitlab.com/");
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (/^gitlab\.com\//i.test(s)) return gitlabId(s.slice("gitlab.com/".length));
  if (/^github\.com\//i.test(s)) s = s.slice("github.com/".length);
  else if (/^[^/]+\.[a-z]{2,}\//i.test(s) && s.split("/").length > 2) return null; // another website
  const [owner, repoRaw] = s.split(/[/?#]/);
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/i, "");
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  return `${owner}/${repo}`;
}

export type Host = "github" | "gitlab";

/** Split a repo id into its parts. For GitLab, `owner` is the full group path. */
export function splitRepoId(id: string): { host: Host; owner: string; repo: string } {
  const host: Host = id.startsWith("gitlab:") ? "gitlab" : "github";
  const parts = (host === "gitlab" ? id.slice("gitlab:".length) : id).split("/");
  const repo = parts.pop() as string;
  return { host, owner: parts.join("/"), repo };
}

export function repoIdOf(r: { host?: Host; owner: string; repo: string }): string {
  return r.host === "gitlab" ? `gitlab:${r.owner}/${r.repo}` : `${r.owner}/${r.repo}`;
}

export const hostName = (host?: Host): string => (host === "gitlab" ? "GitLab" : "GitHub");
