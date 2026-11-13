"use client";

import Link from "next/link";
import { useState } from "react";
import { TOUR_STEPS } from "@/lib/tutorial";

/** The first-time walkthrough shown beside Pixel when the page is opened with ?tour=1. */
export default function Tour({
  ask,
  start,
  inSession,
  onExit,
}: {
  ask: (q: string) => void;
  start: () => void;
  /** True while a session is connecting or live. */
  inSession: boolean;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;
  const a = step.action;
  const mark = () => setDone((prev) => new Set(prev).add(index));

  return (
    <section className="tile grow tour" aria-label="Guided tour">
      <div className="tour-head">
        <h2 className="tile-title">Guided tour</h2>
        <span className="tour-count">Step {index + 1} of {TOUR_STEPS.length}</span>
      </div>
      <div className="tour-dots" aria-hidden>
        {TOUR_STEPS.map((s, i) => (
          <span key={s.title} className={`tour-dot ${i === index ? "on" : ""} ${done.has(i) ? "done" : ""}`} />
        ))}
      </div>

      <div className="tile-body tour-body">
        <h3>{step.title}</h3>
        <p>{step.goal}</p>

        {a.kind === "start" &&
          (inSession ? (
            <p className="tour-ok">Pixel is on the way. Press Next when it says hello.</p>
          ) : (
            <button className="btn" onClick={() => { mark(); start(); }}>Start talking</button>
          ))}

        {a.kind === "ask" && (
          <button className="btn" onClick={() => { mark(); ask(a.question); }}>Ask: {a.label}</button>
        )}

        {a.kind === "self" && (
          <>
            <p className="tour-do"><strong>Try it:</strong> {a.instruction}</p>
            <button className="link-btn" onClick={() => { mark(); ask(a.question); }}>{a.label}</button>
          </>
        )}

        {a.kind === "finish" && (
          <div className="tour-finish">
            <button className="btn" onClick={onExit}>See more questions</button>
            <Link className="btn ghost" href="/">Explore another project</Link>
          </div>
        )}

        {done.has(index) && a.kind === "ask" && <p className="tour-ok">Asked. When Pixel finishes, press Next.</p>}

        <p className="tour-notice"><strong>What to notice:</strong> {step.notice}</p>
      </div>

      <div className="tour-nav">
        <button className="btn ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</button>
        {!last && <button className="btn" onClick={() => setIndex(index + 1)}>Next</button>}
        <button className="link-btn tour-skip" onClick={onExit}>{last ? "Close tour" : "Skip tour"}</button>
      </div>
    </section>
  );
}
