import { parseRepo, RepoError } from "@/lib/github";
import { learnRepo } from "@/lib/learn";
import { allow, clientIp } from "@/lib/ratelimit";
import { getKnowledge } from "@/lib/store";
import type { ProgressEvent } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function friendly(e: unknown): string {
  if (e instanceof RepoError) return e.message;
  console.error("learn failed", e);
  if (e instanceof Error && /no readable code/.test(e.message)) return e.message;
  return "Something went wrong while I was learning that repo. Please try again.";
}

/**
 * POST { url, refresh? } -> newline-delimited JSON progress events, ending in "done" or "error".
 * Without `refresh`, a repo that is already cached is returned immediately.
 * With `refresh`, the host is checked for new commits and the repo is re-learned if it changed.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string; refresh?: boolean };
  const ref = parseRepo(String(body.url ?? ""));
  if (!ref) {
    return Response.json(
      { error: "That doesn't look like a GitHub or GitLab repo link. It should look like github.com/owner/project." },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  const refresh = Boolean(body.refresh);
  if (!allow("repos", ip, 40, 10 * 60_000)) {
    return Response.json({ error: "That's a lot of requests. Take a short break and try again." }, { status: 429 });
  }
  // Learning a brand-new repo costs real money, so it has a tighter limit than cache hits.
  if (!refresh && !(await getKnowledge(ref)) && !allow("learn", ip, 8, 60 * 60_000)) {
    return Response.json(
      { error: "You've taught me a lot of new repos this hour. Try again later, or pick one I already know." },
      { status: 429 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ProgressEvent) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      try {
        const result = await learnRepo(ref, { checkForUpdates: refresh }, (message) =>
          send({ type: "step", message }),
        );
        send({ type: "done", ...result });
      } catch (e) {
        send({ type: "error", message: friendly(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
