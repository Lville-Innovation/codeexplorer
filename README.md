# Code Explorer

Talk to a friendly cartoon fox named Pixel about any public code project. Paste a GitHub or GitLab link, Pixel reads the code, and then you can ask questions out loud or by typing. Pixel explains things in everyday words, shows the exact file and lines it is talking about, and teaches you how to find your own way around a codebase.

It is built for high school students and other people who are not engineers.

## What it does

- Learns one or more public repos from GitHub or gitlab.com and remembers them, so the next visit loads instantly.
- Checks for updates and relearns a repo when its code has changed.
- Answers by voice through a video avatar, with a live transcript.
- Opens files in a code window and highlights the lines being discussed.
- Explains new words on "Words to know" cards as they come up.
- Knows who contributes to a project and how active it has been.
- Suggests questions to ask.

## How it is put together

| Folder | What it is |
| --- | --- |
| `web/` | The website (Next.js). Learns repos, caches them, and hosts the page you talk on. |
| `agent/` | The voice agent (LiveKit Agents for Node). This is Pixel: it listens, looks things up in the code, and talks back. |

Services it relies on: LiveKit (rooms and agent hosting), LemonSlice (avatar video), Deepgram (speech in and out), OpenRouter (language models), and BunnyCDN storage (cache of learned repos).

## Running it yourself

You need Node.js 20 or newer and your own accounts for the services above.

1. Website

   ```bash
   cd web
   cp .env.example .env.local   # then fill in your own values
   npm install
   npm run dev
   ```

2. Agent

   ```bash
   cd agent
   cp .env.example .env.local   # then fill in your own values
   npm install
   npm run dev
   ```

Open http://localhost:3000, type the password you set in `SITE_PASSWORD`, and paste a repo link.

## Deploying

- Website: deploy the `web/` folder to any Next.js host and set the variables from `web/.env.example`.
- Agent: from `agent/`, run `lk agent create` once (this writes your own `livekit.toml`, which is not kept in git), then `lk agent deploy`.

## Secrets

No keys, passwords, or account ids belong in this repo. They live in `.env.local` files and in your hosting provider's settings, both of which are ignored by git.
