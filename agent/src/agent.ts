import { type JobContext, ServerOptions, cli, defineAgent, initializeLogger, tool, voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as lemonslice from '@livekit/agents-plugin-lemonslice';
import * as openai from '@livekit/agents-plugin-openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { type Knowledge, buildInstructions, loadFiles, loadKnowledge, repoIdOf } from './knowledge.js';

dotenv.config({ path: '.env.local' });
initializeLogger({ pretty: false, level: 'info' });

const AGENT_NAME = process.env.REPO_BUDDY_AGENT_NAME || 'repo-buddy';
// The avatar picture ships with the agent and is uploaded to LemonSlice at session start.
const AVATAR_IMAGE = fileURLToPath(new URL('../assets/avatar.png', import.meta.url));
const VOICE = process.env.DEEPGRAM_VOICE || 'aura-2-luna-en';
const MAX_SESSION_MS = 15 * 60_000;
const CONCEPT_TOPIC = 'repo-buddy.concept';
const CODE_TOPIC = 'repo-buddy.code';
const MAX_REPOS = 4;

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    let wanted: string[] = [];
    try {
      const meta = JSON.parse(ctx.job.metadata || '{}') as { repos?: unknown };
      if (Array.isArray(meta.repos)) wanted = meta.repos.map(String).slice(0, MAX_REPOS);
    } catch {
      // No usable metadata; handled below.
    }

    const knowledge = new Map<string, Knowledge>();
    const fileCache = new Map<string, Promise<Record<string, string>>>();

    const loadAll = async () => {
      const loaded = await Promise.all(wanted.map((full) => loadKnowledge(full).catch(() => null)));
      knowledge.clear();
      for (const k of loaded) if (k) knowledge.set(repoIdOf(k).toLowerCase(), k);
    };
    await loadAll();

    /** Match what the model said to a loaded repo, forgiving about case and a missing owner. */
    const resolve = (name: string): Knowledge | null => {
      const n = name.trim().toLowerCase();
      if (knowledge.has(n)) return knowledge.get(n)!;
      for (const k of knowledge.values()) if (`${k.owner}/${k.repo}`.toLowerCase() === n) return k;
      for (const k of knowledge.values()) if (k.repo.toLowerCase() === n) return k;
      return knowledge.size === 1 ? [...knowledge.values()][0]! : null;
    };
    const filesFor = (k: Knowledge) => {
      // Keyed by commit, so a refresh automatically picks up the new files.
      const key = `${k.owner}/${k.repo}@${k.sha}`;
      if (!fileCache.has(key)) fileCache.set(key, loadFiles(repoIdOf(k)));
      return fileCache.get(key)!;
    };
    const unknownRepo = () =>
      `Unknown repo. Use one of: ${[...knowledge.values()].map((k) => `${k.owner}/${k.repo}`).join(', ')}`;
    const repoParam = z.string().describe('The repository as "owner/name"');

    /** Send a file (optionally with highlighted lines) to the code window on the student's screen. */
    const showOnScreen = async (
      k: Knowledge,
      path: string,
      text: string,
      startLine: number | null,
      endLine: number | null,
      caption: string,
    ) => {
      const lines = text.split('\n');
      const MAX_LINES = 600;
      // For a long file, send a window of lines around the highlight.
      let offset = 0;
      if (lines.length > MAX_LINES && startLine) {
        offset = Math.max(0, Math.min(startLine - 100, lines.length - MAX_LINES));
      }
      const shown = lines.slice(offset, offset + MAX_LINES);
      try {
        await ctx.room.localParticipant?.sendText(
          JSON.stringify({
            repo: repoIdOf(k),
            path,
            firstLine: offset + 1,
            totalLines: lines.length,
            code: shown.join('\n'),
            startLine,
            endLine,
            caption,
            // GitHub and GitLab use slightly different addresses for "this file, these lines".
            url: `${k.url}/${k.host === 'gitlab' ? '-/blob' : 'blob'}/${k.sha}/${path.split('/').map(encodeURIComponent).join('/')}${
              startLine
                ? `#L${startLine}${endLine && endLine !== startLine ? (k.host === 'gitlab' ? `-${endLine}` : `-L${endLine}`) : ''}`
                : ''
            }`,
          }),
          { topic: CODE_TOPIC },
        );
      } catch (e) {
        console.error('show code failed', e);
      }
    };

    const tools = [
      tool({
        name: 'list_files',
        description:
          'List the files inside a folder of a repository. Use "" for the top level. Good for finding where things live.',
        parameters: z.object({
          repo: repoParam,
          folder: z.string().describe('Folder path like "src/components", or "" for the top level'),
        }),
        execute: async ({ repo, folder }) => {
          const k = resolve(repo);
          if (!k) return unknownRepo();
          const prefix = folder.replace(/^\.?\/+|\/+$/g, '');
          const seen = new Set<string>();
          for (const p of k.tree) {
            if (prefix && !p.startsWith(prefix + '/')) continue;
            const rest = prefix ? p.slice(prefix.length + 1) : p;
            const [first, ...more] = rest.split('/');
            seen.add(more.length ? `${first}/` : first!);
          }
          if (seen.size === 0) return `Nothing found in "${folder}".`;
          return [...seen].sort().slice(0, 200).join('\n');
        },
      }),
      tool({
        name: 'read_file',
        description:
          'Read the real contents of one file in a repository. Use before explaining what a specific file does.',
        parameters: z.object({
          repo: repoParam,
          path: z.string().describe('Exact file path from the file list, like "src/main.py"'),
        }),
        execute: async ({ repo, path }) => {
          const k = resolve(repo);
          if (!k) return unknownRepo();
          const files = await filesFor(k);
          const clean = path.replace(/^\.?\/+/, '');
          const hit =
            files[clean] !== undefined
              ? clean
              : Object.keys(files).find(
                  (p) => p.toLowerCase() === clean.toLowerCase() || p.toLowerCase().endsWith('/' + clean.toLowerCase()),
                );
          if (!hit) {
            return k.tree.includes(clean)
              ? 'That file exists, but it is too large or not text, so I do not have its contents. Tell the student they can open it on the project site.'
              : 'No file at that path. Use list_files or search_code to find the right path.';
          }
          const text = files[hit]!;
          // Reading a file also puts it on the student's screen, so they see what you see.
          await showOnScreen(k, hit, text, null, null, '');
          const numbered = text
            .split('\n')
            .slice(0, 400)
            .map((line, i) => `${i + 1}: ${line}`)
            .join('\n');
          return `FILE ${hit} (with line numbers)\n${numbered.slice(0, 14_000)}${numbered.length > 14_000 || text.split('\n').length > 400 ? '\n...(file continues)' : ''}`;
        },
      }),
      tool({
        name: 'show_code',
        description:
          "Show a file on the student's screen with specific lines highlighted. Call this every time you talk about a particular file or piece of code, so the student can see exactly what you mean. Use line numbers from read_file or search_code.",
        parameters: z.object({
          repo: repoParam,
          path: z.string().describe('Exact file path, like "src/main.py"'),
          startLine: z.number().int().describe('First line to highlight (1-based). Use 1 if you mean the whole file.'),
          endLine: z.number().int().describe('Last line to highlight. Keep the range focused, ideally under 30 lines.'),
          caption: z
            .string()
            .describe('One short plain-language sentence saying what the highlighted lines do, for a beginner'),
        }),
        execute: async ({ repo, path, startLine, endLine, caption }) => {
          const k = resolve(repo);
          if (!k) return unknownRepo();
          const files = await filesFor(k);
          const clean = path.replace(/^\.?\/+/, '');
          const hit =
            files[clean] !== undefined
              ? clean
              : Object.keys(files).find((p) => p.toLowerCase().endsWith('/' + clean.toLowerCase()) || p.toLowerCase() === clean.toLowerCase());
          if (!hit) return 'No readable file at that path. Use search_code or list_files to find the right path first.';
          const text = files[hit]!;
          const total = text.split('\n').length;
          const from = Math.min(Math.max(1, startLine), total);
          const to = Math.min(Math.max(from, endLine), total);
          await showOnScreen(k, hit, text, from, to, caption);
          return `Now on the student's screen: ${hit}, lines ${from} to ${to} highlighted. Refer to it naturally, for example "look at the highlighted lines on your screen".`;
        },
      }),
      tool({
        name: 'search_code',
        description:
          'Search the code of a repository for a word or short phrase (not a sentence). Returns matching files and lines. Use it to find where something is defined or used.',
        parameters: z.object({
          repo: repoParam,
          query: z.string().describe('A word or short phrase likely to appear in the code or file names'),
        }),
        execute: async ({ repo, query }) => {
          const k = resolve(repo);
          if (!k) return unknownRepo();
          const q = query.trim().toLowerCase();
          if (q.length < 2) return 'Search needs at least 2 characters.';
          const files = await filesFor(k);
          const out: string[] = [];
          const pathHits = k.tree.filter((p) => p.toLowerCase().includes(q)).slice(0, 15);
          if (pathHits.length) out.push(`File names matching:\n${pathHits.join('\n')}`);
          let matches = 0;
          for (const [path, text] of Object.entries(files)) {
            if (matches >= 30) break;
            if (!text.toLowerCase().includes(q)) continue;
            const lines = text.split('\n');
            let perFile = 0;
            for (let i = 0; i < lines.length && perFile < 3 && matches < 30; i++) {
              if (lines[i]!.toLowerCase().includes(q)) {
                out.push(`${path}:${i + 1}: ${lines[i]!.trim().slice(0, 180)}`);
                perFile++;
                matches++;
              }
            }
          }
          return out.length ? out.join('\n') : `No matches for "${query}". Try a different or shorter word.`;
        },
      }),
      tool({
        name: 'show_concept',
        description:
          "Show a concept card on the student's screen. Call this every time you introduce or explain a technical term for the first time. Keep talking normally afterwards; do not mention the card.",
        parameters: z.object({
          term: z.string().describe('The term, 1 to 4 words, like "API" or "Database"'),
          explanation: z
            .string()
            .describe('One or two simple sentences a high school student would understand, with an everyday comparison'),
        }),
        execute: async ({ term, explanation }) => {
          try {
            await ctx.room.localParticipant?.sendText(JSON.stringify({ term, explanation }), {
              topic: CONCEPT_TOPIC,
            });
          } catch (e) {
            console.error('show_concept failed', e);
          }
          return 'Card shown.';
        },
      }),
    ];

    const instructionsNow = () =>
      knowledge.size
        ? buildInstructions([...knowledge.values()])
        : 'You are Pixel, a friendly cartoon red fox. Something went wrong loading the repository notes. Apologize briefly and ask the student to go back and pick the repo again.';

    const agent = new voice.Agent({ instructions: instructionsNow(), tools });

    const session = new voice.AgentSession({
      stt: new deepgram.STT({ model: 'nova-3', language: 'en' }),
      // OpenRouter speaks the OpenAI chat API.
      llm: new openai.LLM({
        model: process.env.AGENT_MODEL || 'anthropic/claude-haiku-5.5',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      }),
      tts: new deepgram.TTS({ model: VOICE }),
      ttsTextTransforms: ['filter_markdown', 'filter_emoji'],
      turnHandling: {
        interruption: { resumeFalseInterruption: false },
        preemptiveGeneration: { enabled: true },
      },
    });

    // The avatar must be attached before the session starts so it owns the audio output.
    const avatar = new lemonslice.AvatarSession({
      agentImage: AVATAR_IMAGE,
      agentPrompt:
        'A friendly, upbeat cartoon fox tutor. Smile, nod, and be expressive and encouraging while explaining.',
      agentIdlePrompt: 'Listen attentively with a warm, curious smile. Blink and nod gently.',
      idleTimeout: 120,
    });
    await avatar.start(session, ctx.room);

    await session.start({
      agent,
      room: ctx.room,
      outputOptions: { syncTranscription: false },
    });

    // The website calls this after "Check for updates" finds and re-learns new commits.
    ctx.room.localParticipant?.registerRpcMethod('refresh_knowledge', async (data) => {
      let repo = '';
      try {
        repo = String((JSON.parse(data.payload || '{}') as { repo?: string }).repo ?? '');
      } catch {
        // Ignore a malformed payload; reload everything anyway.
      }
      await loadAll();
      await agent.updateInstructions(instructionsNow());
      const k = repo ? resolve(repo) : null;
      session.generateReply({
        instructions: `Your notes ${k ? `on ${k.owner}/${k.repo} ` : ''}were just refreshed with the newest changes from the project's site. In one or two short sentences, tell the student you just caught up on the latest version and they can keep asking questions.`,
      });
      return JSON.stringify({ ok: true, sha: k?.sha ?? null });
    });

    const names = [...knowledge.values()].map((k) => k.title).join(' and ');
    session.generateReply({
      instructions: knowledge.size
        ? `Greet the student warmly in two short sentences, starting with "Hey there". Do not address them by any name. Say your name is Pixel, that you've read through ${names}, and invite them to ask anything or tap a suggested question on screen. Do not call any tools for this greeting.`
        : 'Apologize briefly: you could not load the repository notes. Ask the student to go back and try again.',
    });

    // Hard cap on session length to protect usage quotas.
    const warn = setTimeout(() => {
      session.generateReply({
        instructions:
          'Tell the student, in one friendly sentence, that you have about one minute left in this session and they can start a new one any time.',
      });
    }, MAX_SESSION_MS - 60_000);
    const end = setTimeout(() => ctx.shutdown('session time limit'), MAX_SESSION_MS);
    ctx.addShutdownCallback(async () => {
      clearTimeout(warn);
      clearTimeout(end);
    });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
