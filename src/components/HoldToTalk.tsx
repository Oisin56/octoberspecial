"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./Providers";

const MAX_SECONDS = 45;

function audioType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

/**
 * One big button: hold it and talk, let go, and the words appear (golf terms and names spelled right).
 * A quick tap starts it instead, and a second tap stops it, for anyone who taps rather than holds.
 */
export function HoldToTalk({ onText, compact }: { onText: (text: string) => void; compact?: boolean }) {
  const { slug, sample } = useT();
  const [state, setState] = useState<"idle" | "listening" | "writing">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const pressedAt = useRef(0);
  const tapMode = useRef(false);
  const held = useRef(false);
  const stopOnUp = useRef(false);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (state !== "listening") return;
    const t0 = Date.now();
    const i = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setSecs(s);
      if (s >= MAX_SECONDS) stop();
    }, 200);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function start() {
    setErr(null);
    // The sample round: no microphone; it "hears" a sample note
    if (sample) {
      setSecs(0);
      setState("listening");
      setTimeout(() => setState("writing"), 1600);
      setTimeout(() => {
        setState("idle");
        onText(sample.note);
      }, 2300);
      return;
    }
    const type = audioType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) return setErr("Voice notes don't work in this browser. Type it instead.");
    try {
      // The phone's own wind and noise filtering, close to the mouth
      const s = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
      stream.current = s;
      const r = new MediaRecorder(s, type ? { mimeType: type, audioBitsPerSecond: 48_000 } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => send(new Blob(chunks.current, { type: (r.mimeType || type || "audio/webm").split(";")[0] }));
      rec.current = r;
      r.start(250);
      setSecs(0);
      setState("listening");
      // Let go before the microphone opened (or the phone asked permission): it was a tap, so keep listening
      if (!held.current) tapMode.current = true;
    } catch {
      setErr("The microphone didn't open. Allow it for this site, or type instead.");
    }
  }

  function stop() {
    if (sample) return;
    if (rec.current?.state === "recording") rec.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    tapMode.current = false;
  }

  async function send(blob: Blob) {
    if (blob.size < 1500) {
      setState("idle");
      return setErr("Nothing heard. Hold the button while you talk.");
    }
    setState("writing");
    try {
      const f = new FormData();
      f.append("t", slug);
      f.append("file", blob, `note.${/mp4/.test(blob.type) ? "m4a" : "webm"}`);
      const r = await fetch("/api/stt", { method: "POST", body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "That didn't go through. Try again, or type it.");
      if (!j.text) setErr("Couldn't make out any words. Try again, closer to the phone.");
      else onText(String(j.text));
    } catch (e) {
      setErr(navigator.onLine ? (e instanceof Error ? e.message : "That didn't go through.") : "No signal right now. Type it, or try again in a moment.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className={`talk${compact ? " compact" : ""}`}>
      <button
        type="button"
        className={`talk-btn ${state}`}
        disabled={state === "writing"}
        aria-label={state === "listening" ? "Listening. Let go (or tap) to finish" : "Hold to talk"}
        onPointerDown={(e) => {
          e.preventDefault();
          if (state === "listening") {
            stopOnUp.current = true; // the second tap
            return;
          }
          held.current = true;
          pressedAt.current = Date.now();
          start();
        }}
        onPointerUp={() => {
          held.current = false;
          if (stopOnUp.current) {
            stopOnUp.current = false;
            return stop();
          }
          if (state !== "listening") return; // still opening: start() decides
          if (Date.now() - pressedAt.current < 350) tapMode.current = true; // a quick tap: keep listening
          else if (!tapMode.current) stop();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M6 11a6 6 0 0 0 12 0M12 17v4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
        <span>{state === "listening" ? `Listening… ${Math.floor(secs)}s` : state === "writing" ? "Writing it down…" : "Hold to talk"}</span>
      </button>
      {state === "listening" && <p className="talk-tip">Let go (or tap again) when you&apos;re done. Phone close to your mouth, back to the wind.</p>}
      {err && <p className="talk-err">{err}</p>}
    </div>
  );
}
