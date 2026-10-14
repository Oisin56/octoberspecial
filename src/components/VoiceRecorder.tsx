"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SECONDS = 30;

/** 16-bit mono WAV: plays everywhere, including the video service. */
function wav(chunks: Float32Array[], rate: number): Blob {
  const n = chunks.reduce((t, c) => t + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks)
    for (let i = 0; i < c.length; i++, o += 2) {
      const x = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * Record a line in your own voice: tap to start, tap to stop (up to 30 seconds). Hands back a WAV and its length.
 */
export function VoiceRecorder({ onDone, label = "Record it yourself" }: { onDone: (file: Blob, sec: number) => void; label?: string }) {
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(node);
      node.connect(ctx.destination);
      const t0 = Date.now();
      const tick = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setSecs(s);
        if (s >= MAX_SECONDS) stop();
      }, 200);
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(tick);
        node.disconnect();
        src.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        const rate = ctx.sampleRate;
        ctx.close().catch(() => null);
        setOn(false);
        stopRef.current = null;
        const n = chunks.reduce((t, c) => t + c.length, 0);
        if (n / rate < 0.4) return setErr("That was too short. Tap, say the line, then tap again.");
        onDone(wav(chunks, rate), Math.round((n / rate) * 100) / 100);
      };
      stopRef.current = stop;
      setSecs(0);
      setOn(true);
    } catch {
      setErr("The microphone didn't open. Allow it for this site, then try again.");
    }
  }

  return (
    <span className="vrec">
      <button type="button" className={`btn secondary vrec-btn${on ? " on" : ""}`} onClick={() => (on ? stopRef.current?.() : start())}>
        {on ? `Stop (${Math.floor(secs)}s)` : label}
      </button>
      {err && <small className="error">{err}</small>}
    </span>
  );
}
