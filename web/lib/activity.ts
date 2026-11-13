import type { Activity, CommitInfo, RepoRef } from "./types";

const DAY = 86_400_000;

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-learning-tool",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional: with a token the GitHub limit is 5,000 requests/hour instead of 60.
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function api<T>(path: string): Promise<{ data: T; link: string } | null> {
  try {
    const res = await fetch(`https://api.github.com${path}`, { headers: apiHeaders(), cache: "no-store" });
    if (!res.ok) return null;
    return { data: (await res.json()) as T, link: res.headers.get("link") ?? "" };
  } catch {
    return null;
  }
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Fallback when the API is rate limited: GitHub's public commit feed (about 20 latest commits). */
async function commitsFromFeed(r: RepoRef): Promise<CommitInfo[]> {
  try {
    const res = await fetch(`https://github.com/${r.owner}/${r.repo}/commits/HEAD.atom`, { cache: "no-store" });
    if (!res.ok) return [];
    const xml = await res.text();
    return xml
      .split("<entry>")
      .slice(1)
      .map((e): CommitInfo | null => {
        const sha = e.match(/Commit\/([0-9a-f]{40})/)?.[1];
        const date = e.match(/<updated>([^<]+)<\/updated>/)?.[1];
        const author = e.match(/<name>([^<]+)<\/name>/)?.[1];
        const title = e.match(/<title>([\s\S]*?)<\/title>/)?.[1];
        if (!sha || !date) return null;
        const name = unescape(author ?? "unknown").trim();
        return { sha: sha.slice(0, 7), author: name, login: name, date, message: unescape(title ?? "").trim().slice(0, 160) };
      })
      .filter((c): c is CommitInfo => c !== null);
  } catch {
    return [];
  }
}

interface ApiCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string; type?: string } | null;
}
interface ApiContributor {
  login: string;
  contributions: number;
  type?: string;
}
interface ApiRepo {
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  created_at: string;
  language: string | null;
  license: { spdx_id: string | null; name: string } | null;
  description: string | null;
}

const isBot = (login: string, type?: string) => type === "Bot" || /\[bot\]$|-bot$|^dependabot|^renovate/i.test(login);

/** The same facts from either host, before any counting is done. */
interface Raw {
  source: Activity["source"];
  recent: CommitInfo[];
  /** How many commits a full page from this source holds; used to tell "30" from "30 or more". */
  pageSize: number;
  people: { login: string; contributions: number }[] | null;
  peopleCapped: boolean;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  createdAt: string | null;
  language: string | null;
  license: string | null;
}

async function fromGitHub(r: RepoRef): Promise<Raw> {
  const base = `/repos/${r.owner}/${r.repo}`;
  const [repo, contributors, commits] = await Promise.all([
    api<ApiRepo>(base),
    api<ApiContributor[]>(`${base}/contributors?per_page=100`),
    api<ApiCommit[]>(`${base}/commits?per_page=100`),
  ]);

  let recent: CommitInfo[] = [];
  let source: Activity["source"] = "none";
  if (commits && Array.isArray(commits.data)) {
    source = "api";
    recent = commits.data.map((c) => ({
      sha: c.sha.slice(0, 7),
      author: c.commit.author?.name ?? c.author?.login ?? "unknown",
      login: c.author?.login ?? c.commit.author?.name ?? "unknown",
      date: c.commit.author?.date ?? "",
      message: (c.commit.message ?? "").split("\n")[0].slice(0, 160),
      bot: c.author ? isBot(c.author.login, c.author.type) : false,
    }));
  } else {
    recent = await commitsFromFeed(r);
    if (recent.length) source = "feed";
  }

  return {
    source,
    recent,
    pageSize: source === "api" ? 100 : 20,
    people: contributors
      ? contributors.data.filter((c) => c.login && !isBot(c.login, c.type)).map((c) => ({ login: c.login, contributions: c.contributions }))
      : null,
    peopleCapped: Boolean(contributors && /rel="next"/.test(contributors.link)),
    stars: repo?.data.stargazers_count ?? null,
    forks: repo?.data.forks_count ?? null,
    openIssues: repo?.data.open_issues_count ?? null,
    createdAt: repo?.data.created_at ?? null,
    language: repo?.data.language ?? null,
    license: repo?.data.license?.spdx_id ?? repo?.data.license?.name ?? null,
  };
}

interface GitLabProject {
  star_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  created_at?: string;
  license?: { name?: string; nickname?: string | null } | null;
}
interface GitLabContributor {
  name: string;
  commits: number;
}
interface GitLabCommit {
  id: string;
  title: string;
  author_name: string;
  committed_date?: string;
  authored_date?: string;
}

async function gitlab<T>(path: string): Promise<{ data: T; more: boolean } | null> {
  try {
    const res = await fetch(`https://gitlab.com/api/v4${path}`, {
      headers: { "User-Agent": "repo-learning-tool" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return { data: (await res.json()) as T, more: Boolean(res.headers.get("x-next-page")) };
  } catch {
    return null;
  }
}

async function fromGitLab(r: RepoRef): Promise<Raw> {
  const base = `/projects/${encodeURIComponent(`${r.owner}/${r.repo}`)}`;
  const [project, contributors, commits, languages] = await Promise.all([
    gitlab<GitLabProject>(`${base}?license=true`),
    gitlab<GitLabContributor[]>(`${base}/repository/contributors?per_page=100&order_by=commits&sort=desc`),
    gitlab<GitLabCommit[]>(`${base}/repository/commits?per_page=100`),
    gitlab<Record<string, number>>(`${base}/languages`),
  ]);

  const list = commits && Array.isArray(commits.data) ? commits.data : [];
  // GitLab identifies commit authors by the name in the commit. Email addresses are never kept.
  const recent: CommitInfo[] = list.map((c) => ({
    sha: c.id.slice(0, 7),
    author: c.author_name || "unknown",
    login: c.author_name || "unknown",
    date: c.committed_date ?? c.authored_date ?? "",
    message: (c.title ?? "").slice(0, 160),
    bot: isBot(c.author_name ?? ""),
  }));

  const topLanguage = languages ? Object.entries(languages.data).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
  const people = contributors && Array.isArray(contributors.data)
    ? contributors.data.filter((c) => c.name && !isBot(c.name)).map((c) => ({ login: c.name, contributions: c.commits }))
    : null;

  return {
    source: commits ? "api" : "none",
    recent,
    pageSize: 100,
    people: people ? [...people].sort((a, b) => b.contributions - a.contributions) : null,
    peopleCapped: Boolean(contributors?.more),
    stars: project?.data.star_count ?? null,
    forks: project?.data.forks_count ?? null,
    openIssues: project?.data.open_issues_count ?? null,
    createdAt: project?.data.created_at ?? null,
    language: topLanguage,
    license: project?.data.license?.nickname ?? project?.data.license?.name ?? null,
  };
}

/** Who works on the repo and how busy it has been. Never throws; returns what it could find. */
export async function getActivity(r: RepoRef): Promise<Activity> {
  const raw = r.host === "gitlab" ? await fromGitLab(r) : await fromGitHub(r);
  const { recent, source } = raw;

  const now = Date.now();
  const age = (c: CommitInfo) => now - new Date(c.date).getTime();
  const human = recent.filter((c) => !c.bot);
  const within = (days: number) => recent.filter((c) => age(c) <= days * DAY).length;
  const oldest = recent.length ? recent[recent.length - 1].date : null;
  // If even the oldest commit we fetched is inside the window, the true count is higher.
  const capped = (days: number) =>
    Boolean(oldest) && recent.length >= raw.pageSize && now - new Date(oldest as string).getTime() <= days * DAY;

  const tally = new Map<string, number>();
  for (const c of human) tally.set(c.login, (tally.get(c.login) ?? 0) + 1);
  const topRecent = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([login, count]) => ({ login, commits: count }));

  const last30 = within(30);
  const last90 = within(90);
  const lastCommitDate = recent[0]?.date ?? null;
  const daysSince = lastCommitDate ? Math.floor((now - new Date(lastCommitDate).getTime()) / DAY) : null;
  const level: Activity["level"] =
    daysSince === null ? "unknown"
    : last30 >= 20 ? "very active"
    : last30 >= 4 ? "active"
    : last90 >= 1 ? "quiet"
    : daysSince <= 365 ? "slow"
    : "dormant";

  return {
    source,
    fetchedAt: new Date().toISOString(),
    stars: raw.stars,
    forks: raw.forks,
    openIssues: raw.openIssues,
    createdAt: raw.createdAt,
    language: raw.language,
    license: raw.license,
    contributors: (raw.people ?? []).slice(0, 30),
    contributorCount: raw.people ? raw.people.length : null,
    contributorCountCapped: raw.peopleCapped,
    recentCommits: recent.slice(0, 40).map(({ bot: _bot, ...c }) => c),
    window: recent.length,
    windowStart: oldest,
    last30,
    last30Capped: capped(30),
    last90,
    last90Capped: capped(90),
    lastCommitDate,
    daysSinceLastCommit: daysSince,
    topRecent,
    level,
  };
}
