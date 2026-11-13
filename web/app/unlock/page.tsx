"use client";

import Image from "next/image";
import { useState } from "react";

export default function Unlock() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong. Try again.");
        return;
      }
      // Only follow same-site paths, never a full URL from the query string.
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.assign(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <section className="card learning">
        <Image src="/avatar.png" alt="Pixel the fox" width={184} height={280} className="learning-fox" priority />
        <form className="learning-body" onSubmit={submit}>
          <p className="eyebrow">Big Red only</p>
          <h1>Hey there! What&apos;s the password?</h1>
          <p className="muted">This page is for the Lville community. Your teacher has the password.</p>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Site password"
            autoFocus
            autoComplete="current-password"
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn big" type="submit" disabled={busy || !password.trim()}>
            {busy ? "Checking…" : "Let me in"}
          </button>
        </form>
      </section>
    </main>
  );
}
