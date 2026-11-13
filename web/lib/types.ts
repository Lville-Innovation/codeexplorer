import { repoIdOf, type Host } from "./parse";

export interface RepoRef {
  /** Missing means GitHub (older cached data has no host). */
  host?: Host;
  /** For GitLab this is the full group path, e.g. "group/subgroup". */
  owner: string;
  repo: string;
}

export interface Explained {
  name: string;
  explanation: string;
}

export interface RepoPart {
  name: string;
  where: string;
  explanation: string;
}

export interface CommitInfo {
  sha: string;
  author: string;
  login: string;
  date: string;
  message: string;
  bot?: boolean;
}

/** Who works on the repo and how busy it has been. */
export interface Activity {
  source: "api" | "feed" | "none";
  fetchedAt: string;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  createdAt: string | null;
  language: string | null;
  license: string | null;
  /** All-time top contributors by number of commits. */
  contributors: { login: string; contributions: number }[];
  contributorCount: number | null;
  contributorCountCapped: boolean;
  recentCommits: CommitInfo[];
  /** How many of the latest commits were looked at, and how far back they go. */
  window: number;
  windowStart: string | null;
  last30: number;
  last30Capped: boolean;
  last90: number;
  last90Capped: boolean;
  lastCommitDate: string | null;
  daysSinceLastCommit: number | null;
  /** Most active people within the recent-commit window. */
  topRecent: { login: string; commits: number }[];
  level: "very active" | "active" | "quiet" | "slow" | "dormant" | "unknown";
}

/** Bump when the shape of Knowledge changes, so older cached copies are re-learned. */
export const KNOWLEDGE_VERSION = 2;

/** Everything the avatar "knows" about a repo, minus the raw file contents. */
export interface Knowledge {
  version?: number;
  host?: Host;
  owner: string;
  repo: string;
  url: string;
  sha: string;
  defaultBranch: string;
  commitDate: string | null;
  learnedAt: string;
  fileCount: number;
  totalPaths: number;
  truncated: boolean;
  title: string;
  oneLiner: string;
  summary: string;
  analogy: string;
  parts: RepoPart[];
  tech: Explained[];
  glossary: Explained[];
  questions: string[];
  /** Plain-language summary of what people have been working on lately. */
  recentChanges?: string;
  activity?: Activity | null;
  tree: string[];
}

export interface RecentRepo {
  host?: Host;
  owner: string;
  repo: string;
  oneLiner: string;
  learnedAt: string;
}

export type ProgressEvent =
  | { type: "step"; message: string }
  | { type: "done"; knowledge: Knowledge; cached: boolean; updated: boolean }
  | { type: "error"; message: string };

export const MAX_REPOS = 4;

export function repoKey(r: RepoRef): string {
  return repoIdOf(r);
}
