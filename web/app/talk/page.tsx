import { Suspense } from "react";
import Talk from "./Talk";

export default function TalkPage() {
  return (
    <Suspense fallback={<main className="page narrow"><p className="muted">Loading…</p></main>}>
      <Talk />
    </Suspense>
  );
}
