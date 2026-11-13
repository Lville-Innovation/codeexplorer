// Reads the repo knowledge that the website cached in BunnyCDN storage.

export interface Explained {
  name: string;
  explanation: string;
}

export interface Knowledge {
  /** Missing means GitHub. */
  host?: 'github' | 'gitlab';
  /** For GitLab this is the full group path. */
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
  parts: { name: string; where: string; explanation: string }[];
  tech: Explained[];
  glossary: Explained[];
  questions: string[];
  recentChanges?: string;
  activity?: Activity | null;
  tree: string[];
}

export interface Activity {
  source: 'api' | 'feed' | 'none';
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  createdAt: string | null;
  language: string | null;
  license: string | null;
  contributors: { login: string; contributions: number }[];
  contributorCount: number | null;
  contributorCountCapped: boolean;
  recentCommits: { sha: string; author: string; login: string; date: string; message: string }[];
  window: number;
  windowStart: string | null;
  last30: number;
  last30Capped: boolean;
  last90: number;
  last90Capped: boolean;
  lastCommitDate: string | null;
  daysSinceLastCommit: number | null;
  topRecent: { login: string; commits: number }[];
  level: string;
}

function activitySection(k: Knowledge): string {
  const a = k.activity;
  if (!a || a.source === 'none') {
    return 'People and activity: you could not load contributor or commit history for this repo. If asked, say so and suggest looking at the project page on its host.';
  }
  const n = (v: number | null) => (v === null ? 'unknown' : v.toLocaleString('en-US'));
  const plus = (v: number, capped: boolean) => `${v}${capped ? ' or more' : ''}`;
  const lines = [
    'People and activity (a "commit" is one saved change to the code; explain that the first time you use the word):',
    `- Activity level: ${a.level}. Last commit ${a.lastCommitDate ? a.lastCommitDate.slice(0, 10) : 'unknown'}${a.daysSinceLastCommit !== null ? ` (${a.daysSinceLastCommit} days before you learned it)` : ''}.`,
    `- Commits in the last 30 days: ${plus(a.last30, a.last30Capped)}. In the last 90 days: ${plus(a.last90, a.last90Capped)}.`,
    `- Number of contributors: ${a.contributorCount === null ? 'unknown' : plus(a.contributorCount, a.contributorCountCapped)}.`,
    `- Stars: ${n(a.stars)}. Forks (copies people made to work on): ${n(a.forks)}. Open issues and pull requests: ${n(a.openIssues)}. Created: ${a.createdAt ? a.createdAt.slice(0, 10) : 'unknown'}. License: ${a.license ?? 'unknown'}.`,
  ];
  if (a.contributors.length) {
    lines.push(`- Top contributors of all time, by commits: ${a.contributors.slice(0, 15).map((c) => `${c.login} (${c.contributions})`).join(', ')}.`);
  }
  if (a.topRecent.length) {
    lines.push(`- Most active recently (within the latest ${a.window} commits, going back to ${a.windowStart ? a.windowStart.slice(0, 10) : 'unknown'}): ${a.topRecent.map((p) => `${p.login} (${p.commits})`).join(', ')}.`);
  }
  if (k.recentChanges) lines.push(`- What has been happening lately: ${k.recentChanges}`);
  if (a.recentCommits.length) {
    lines.push('- Latest commits, newest first (date, who, message):');
    for (const c of a.recentCommits.slice(0, 30)) lines.push(`    ${c.date.slice(0, 10)} ${c.login}: ${c.message}`);
  }
  lines.push('When talking about people, use their names or usernames exactly as written, stick to these numbers, and be clear that commit counts measure how many changes someone saved, not how valuable their work is. All-time and recent rankings can differ; say which one you mean.');
  return lines.join('\n');
}

const PREFIX = 'talktocodingrepo';

function base(): string {
  const zone = process.env.BUNNYCDN_STORAGE_ZONE_NAME;
  if (!zone || !process.env.BUNNYCDN_ACCESS_KEY) throw new Error('BunnyCDN storage is not configured');
  const region = (process.env.BUNNYCDN_REGION ?? '').toLowerCase();
  const host = !region || region === 'de' ? 'storage.bunnycdn.com' : `${region}.storage.bunnycdn.com`;
  return `https://${host}/${zone}/${PREFIX}`;
}

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${base()}/${path}`, {
    headers: { AccessKey: process.env.BUNNYCDN_ACCESS_KEY as string },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storage read failed (${res.status}) for ${path}`);
  return (await res.json()) as T;
}

const SLUG = /^[A-Za-z0-9._-]{1,100}$/;

/** Repo ids are "owner/repo" for GitHub and "gitlab:group/subgroup/project" for GitLab. */
export function repoIdOf(k: { host?: 'github' | 'gitlab'; owner: string; repo: string }): string {
  return k.host === 'gitlab' ? `gitlab:${k.owner}/${k.repo}` : `${k.owner}/${k.repo}`;
}

/** Cache folder for a repo id. Must match the website's lib/store.ts. */
function dir(id: string): string | null {
  const gitlab = id.startsWith('gitlab:');
  const parts = (gitlab ? id.slice('gitlab:'.length) : id).split('/');
  if (parts.length < 2 || parts.length > (gitlab ? 8 : 2) || !parts.every((p) => SLUG.test(p))) return null;
  const flat = parts.join('__').toLowerCase();
  return gitlab ? `repos/gitlab/${flat}` : `repos/${flat}`;
}

export async function loadKnowledge(full: string): Promise<Knowledge | null> {
  const d = dir(full);
  return d ? getJson<Knowledge>(`${d}/knowledge.json`) : null;
}

export async function loadFiles(full: string): Promise<Record<string, string>> {
  const d = dir(full);
  const data = d ? await getJson<{ files: Record<string, string> }>(`${d}/files.json`) : null;
  return data?.files ?? {};
}

function compactTree(tree: string[], max: number): string {
  if (tree.length <= max) return tree.join('\n');
  // Too many files to list: show folders with file counts, plus top-level files.
  const counts = new Map<string, number>();
  const top: string[] = [];
  for (const p of tree) {
    const parts = p.split('/');
    if (parts.length === 1) top.push(p);
    else {
      const folder = parts.slice(0, Math.min(2, parts.length - 1)).join('/') + '/';
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  const folders = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  return [...top.slice(0, 60), ...folders.map(([f, n]) => `${f}  (${n} files)`)].join('\n');
}

export function buildInstructions(repos: Knowledge[]): string {
  const intro = `You are Pixel, a cheerful cartoon red fox who loves helping high school students understand real code projects hosted on GitHub or GitLab. You are talking out loud with a student through a video avatar.

WHO YOU ARE TALKING TO
A curious high school student with little or no programming experience. You do not know their name, so never address them by a name, nickname or group name (do not call them "Big Red"); just say "hey there" or "you". They may open the code on GitHub and look at it, but they are not an engineer.

HOW TO TALK
- This is a spoken conversation. Keep answers short: usually 2 to 4 sentences, then check in or offer one next thing to explore.
- Plain everyday words. No markdown, no bullet points, no emoji, no reading out long code. Say file names naturally, like "the file called app dot py in the source folder".
- The first time any technical word comes up (like API, function, server, database, framework, variable, repository, commit), explain it in one simple sentence, ideally with an everyday comparison, and call the show_concept tool so it appears on the student's screen as a card.
- Use analogies from daily teenage life: school, sports, games, phones, cooking, group chats.
- Be warm and encouraging. Never make the student feel bad for not knowing something. Curiosity is the goal.
- When you explain something, mention which file or folder it lives in so they can go look at it on the project's site.

SHOWING THE CODE
- The student has a code window on their screen. Whenever you talk about a particular file or piece of code, call show_code with the file path, the lines that matter, and a one-sentence caption, so they can see exactly what you mean. Then point to it: "look at the highlighted lines on your screen".
- Keep highlights small and focused (a function, a few lines), and explain them in everyday words instead of reading code aloud.
- The student also has a file list and can tap a file to ask you about it. When asked to show or explain a file, read it, show it, and explain its job in the project in two or three sentences.

TEACHING HOW TO EXPLORE
- Your deeper goal is to teach the student how to find their own way around a codebase. When you look something up, briefly say how you found it: "I searched for the word signature", "I started with the README, which is the welcome page of a project", "folder names are like labels on drawers".
- Now and then, suggest a next step they could try themselves, such as tapping a file in the file list or asking where a feature starts.

STAYING ACCURATE
- Your notes below are a summary. For any question about how something specifically works, where something is, or what a file contains, use your tools (search_code, read_file, list_files) to look at the real code before answering. Don't guess.
- When you need to look something up, first say a very short phrase like "Let me peek at the code", then use the tool.
- If you can't find something, say so honestly and suggest where it might be.
- Stay on the topic of these repositories and the programming ideas needed to understand them. If asked about something unrelated, gently steer back.
- If the student seems stuck, suggest one specific, interesting question they could ask next.`;

  const sections = repos.map((k) => {
    const lines = [
      `REPOSITORY: ${k.owner}/${k.repo}, hosted on ${k.host === 'gitlab' ? 'GitLab' : 'GitHub'}  (use "${k.owner}/${k.repo}" as the repo argument in tools)`,
      `Name: ${k.title}`,
      `In one line: ${k.oneLiner}`,
      `Summary: ${k.summary}`,
      `Analogy you can use: ${k.analogy}`,
      `Latest change you know about: ${k.commitDate ? k.commitDate.slice(0, 10) : 'unknown'} (commit ${k.sha.slice(0, 7)})`,
      `Main parts:\n${k.parts.map((p) => `- ${p.name} (${p.where || 'various places'}): ${p.explanation}`).join('\n')}`,
      `Technology used:\n${k.tech.map((t) => `- ${t.name}: ${t.explanation}`).join('\n')}`,
      activitySection(k),
      `Words worth explaining:\n${k.glossary.map((g) => `- ${g.name}: ${g.explanation}`).join('\n')}`,
      `Files (${k.totalPaths} total${k.truncated ? '; the project is large, so you only hold the most important files' : ''}):\n${compactTree(k.tree, 350)}`,
    ];
    return lines.join('\n');
  });

  const multi =
    repos.length > 1
      ? `\n\nThe student picked ${repos.length} repositories. Be clear about which one you are talking about, and feel free to compare them.`
      : '';

  return `${intro}${multi}\n\n==== YOUR NOTES ====\n\n${sections.join('\n\n----\n\n')}`;
}
