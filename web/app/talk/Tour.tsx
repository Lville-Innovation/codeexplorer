"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TOUR_STEPS, tourNote } from "@/lib/tutorial";

/** How long Pixel must be quiet before the tour asks the next question. */
const ASK_AFTER_MS = 2500;
/** How long the student gets to try a hands-on step before Pixel does it for them. */
const SELF_WAIT_MS = 15000;
/** Quiet time after an answer before moving on, so there is time to look at the screen. */
const ADVANCE_AFTER_MS = 6000;

/**
 * The first-time walkthrough shown beside Pixel when the page is opened with ?tour=1.
 * After one press of "Begin the tour" it runs by itself: it asks each guiding question
 * when Pixel is free, waits for the answer, then moves to the next step.
 */
export default function Tour({
  ask,
  start,
  inSession,
  agentReady,
  agentState,
  currentFile,
  openTab,
  onExit,
}: {
  /** Asks Pixel a question; `hidden` is sent along but not shown in the conversation. */
  ask: (q: string, hidden?: string) => void;
  start: () => void;
  /** True while a session is connecting or live. */
  inSession: boolean;
  agentReady: boolean;
  agentState: string;
  /** Path of the file now in the Code window, if any. */
  currentFile: string | null;
  openTab: (tab: "words" | "about" | "people") => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const [asked, setAsked] = useState<Set<number>>(new Set());
  const [welcome, setWelcome] = useState(true);
  /** Pixel has started answering the current step. */
  const responded = useRef(false);

  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;
  const a = step.action;
  const wasAsked = a.kind === "start" ? inSession : asked.has(index);
  const busy = agentState === "thinking" || agentState === "speaking";
  const idle = agentReady && agentState === "listening";

  const go = (i: number) => {
    responded.current = false;
    setIndex(i);
  };
  const askStep = () => {
    if (a.kind !== "ask" && a.kind !== "self") return;
    setAsked((prev) => new Set(prev).add(index));
    ask(a.question, tourNote(index + 1, step.direct));
  };

  // Open the side panel this step talks about.
  useEffect(() => {
    if (step.tab) openTab(step.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Notice when Pixel starts answering. On a hands-on step, that also means the student acted.
  useEffect(() => {
    if (!agentReady || !busy) return;
    if (wasAsked) responded.current = true;
    else if (a.kind === "self") {
      responded.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAsked((prev) => new Set(prev).add(index));
    }
  }, [agentReady, busy, wasAsked, a.kind, index]);

  // Autopilot: ask this step's question once Pixel is free.
  useEffect(() => {
    if (!auto || !idle || wasAsked || (a.kind !== "ask" && a.kind !== "self")) return;
    const t = setTimeout(askStep, a.kind === "self" ? SELF_WAIT_MS : ASK_AFTER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, idle, wasAsked, index]);

  // Autopilot: once Pixel has answered and gone quiet, move on.
  useEffect(() => {
    if (!auto || !idle || !wasAsked || !responded.current || last) return;
    const t = setTimeout(() => go(index + 1), ADVANCE_AFTER_MS);
    return () => clearTimeout(t);
  }, [auto, idle, wasAsked, index, last]);

  const begin = () => {
    setWelcome(false);
    setAuto(true);
    start();
  };

  const autoNote =
    !auto || last || !inSession ? null
    : !agentReady ? "Pixel is on the way…"
    : busy ? "Pixel is answering. The tour moves on by itself."
    : wasAsked ? "Next step coming up…"
    : a.kind === "self" ? "Give it a try. Pixel will open it for you in a few seconds."
    : "Asking Pixel…";

  return (
    <section className="tour-banner" aria-label="Guided tour">
      {welcome && !inSession && (
        <div className="tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-welcome-title">
          <div className="tour-welcome-card">
            <h2 id="tour-welcome-title">Welcome! Let Pixel show you around.</h2>
            <p>
              In about five minutes, Pixel will walk you through a sample project: what it does, where things live, and
              how to find the code behind a feature. The tour runs by itself. Just watch, listen, and jump in with a
              question whenever you like.
            </p>
            <p className="muted small">Your browser may ask to use your microphone. You can say no and type instead.</p>
            <div className="tour-actions">
              <button className="btn big" onClick={begin} autoFocus>Begin the tour</button>
              <button className="btn ghost" onClick={onExit}>Skip, I&apos;ll explore on my own</button>
            </div>
          </div>
        </div>
      )}

      <div className="tour-step" aria-hidden>
        <strong>{index + 1}</strong>
        <span>of {TOUR_STEPS.length}</span>
      </div>

      <div className="tour-main">
        <p className="tour-kicker">Guided tour</p>
        <h2>{step.title}</h2>
        <p>{step.goal}</p>
        {a.kind === "self" && !wasAsked && <p className="tour-do"><strong>Try it:</strong> {a.instruction}</p>}
        {autoNote && <p className="tour-status" aria-live="polite">{autoNote}</p>}
        {step.file && currentFile === step.file && <p className="tour-status">Now in the Code window: {step.file}</p>}
      </div>

      <p className="tour-notice"><strong>What to notice</strong>{step.notice}</p>

      <div className="tour-side">
        <div className="tour-actions">
          {a.kind === "start" && !inSession && <button className="btn light" onClick={begin}>Begin the tour</button>}
          {a.kind === "ask" && !wasAsked && !auto && <button className="btn light" onClick={askStep}>Ask: {a.label}</button>}
          {a.kind === "self" && !wasAsked && <button className="btn light" onClick={askStep}>{a.label}</button>}
          {a.kind === "finish" && (
            <>
              <button className="btn light" onClick={onExit}>Keep asking questions</button>
              <Link className="btn light" href="/">Explore another project</Link>
            </>
          )}
        </div>
        <div className="tour-actions">
          <button className="btn outline" disabled={index === 0} onClick={() => { setAuto(false); go(index - 1); }}>Back</button>
          {!last && <button className="btn outline" onClick={() => go(index + 1)}>Next</button>}
          {!last && inSession && <button className="btn outline" onClick={() => setAuto(!auto)}>{auto ? "Pause" : "Resume"}</button>}
          <button className="btn outline" onClick={onExit}>{last ? "Close" : "Skip tour"}</button>
        </div>
      </div>

      <div className="tour-dots" aria-hidden>
        {TOUR_STEPS.map((s, i) => (
          <span key={s.title} className={`tour-dot ${i === index ? "on" : ""} ${i < index ? "done" : ""}`} />
        ))}
      </div>
    </section>
  );
}
