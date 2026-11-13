import { randomUUID } from "node:crypto";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { parseRepo } from "@/lib/github";
import { repoIdOf } from "@/lib/parse";
import { allow, clientIp } from "@/lib/ratelimit";
import { getKnowledge } from "@/lib/store";
import { MAX_REPOS } from "@/lib/types";

export const dynamic = "force-dynamic";

const AGENT_NAME = process.env.REPO_BUDDY_AGENT_NAME || "repo-buddy";

/** POST { repos: ["owner/repo", ...] } -> a LiveKit token for a fresh room with the avatar agent dispatched. */
export async function POST(req: Request) {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return Response.json({ error: "Voice is not configured on the server." }, { status: 500 });
  }
  if (!allow("token", clientIp(req), 12, 10 * 60_000)) {
    return Response.json({ error: "Too many sessions started. Wait a few minutes and try again." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { repos?: unknown };
  const refs = (Array.isArray(body.repos) ? body.repos : [])
    .slice(0, MAX_REPOS)
    .map((r) => parseRepo(String(r)))
    .filter((r) => r !== null);
  if (refs.length === 0) return Response.json({ error: "Pick at least one repo first." }, { status: 400 });

  // Only repos that have actually been learned can be talked about.
  const known = await Promise.all(refs.map((r) => getKnowledge(r)));
  if (known.some((k) => !k)) {
    return Response.json({ error: "One of those repos hasn't been learned yet." }, { status: 400 });
  }

  const room = `repo-${randomUUID()}`;
  const identity = `student-${randomUUID().slice(0, 8)}`;
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: "20m" });
  token.addGrant({ room, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: AGENT_NAME,
        metadata: JSON.stringify({ repos: refs.map((r) => repoIdOf(r)) }),
      }),
    ],
  });

  return Response.json({ url: LIVEKIT_URL, token: await token.toJwt(), room, identity });
}
