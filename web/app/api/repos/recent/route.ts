import { getRecent } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ repos: await getRecent() });
  } catch (e) {
    console.error("recent failed", e);
    return Response.json({ repos: [] });
  }
}
