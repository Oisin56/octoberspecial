"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { ClipDetail } from "@/components/ClipDetail";
import { setPendingClip } from "@/lib/pendingClip";

const MAX_SECONDS = 60;
const MAX_BYTES = 50 * 1024 * 1024;

/** Best format this phone can record: mp4 where it can (iPhone), else webm. */
function pickType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/**
 * The camera, inside the site: one big button to record, then the clip's details. Recorded at a size that
 * uploads on course signal (about 6 MB for 20 seconds). If the camera can't open here, the phone's own
 * camera or the camera roll work instead.
 */
function RecordInner() {
  const { state, href } = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const round = useMemo(() => {
    if (!state) return null;
    const n = sp.get("round");
    return (n && state.rounds.find((r) => r.number === Number(n))) || state.rounds.find((r) => r.status === "live") || null;
  }, [state, sp]);
  const hole = sp.get("hole") ? Number(sp.get("hole")) : null;

  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<"starting" | "ready" | "recording" | "failed">("starting");
  const [secs, setSecs] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setPhase("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || pickType() === null) throw new Error("no camera here");
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: { noiseSuppression: true, echoCancellation: false },
      });
      stream.current = s;
      if (preview.current) {
        preview.current.srcObject = s;
        await preview.current.play().catch(() => {});
      }
      setPhase("ready");
    } catch {
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    if (clip) return;
    startCamera();
    return () => stopCamera();
  }, [clip, startCamera, stopCamera]);

  // Stop automatically at the limit
  useEffect(() => {
    if (phase !== "recording") return;
    const t0 = Date.now();
    const i = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setSecs(s);
      if (s >= MAX_SECONDS) rec.current?.stop();
    }, 200);
    return () => clearInterval(i);
  }, [phase]);

  function toggle() {
    if (phase === "recording") return rec.current?.stop();
    if (!stream.current) return;
    const type = pickType() || undefined;
    const r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: (r.mimeType || type || "video/mp4").split(";")[0] });
      stopCamera();
      setPhase("ready");
      setClip(blob);
    };
    rec.current = r;
    r.start(500);
    setSecs(0);
    setPhase("recording");
  }

  const toScorecard = (msg?: string) => {
    if (msg) sessionStorage.setItem("mgs_flash", msg);
    router.push(href("/score"));
  };

  function picked(f: File | undefined) {
    if (!f) return;
    // Very big files from the camera roll still go through the cutter
    if (f.size > MAX_BYTES) {
      setPendingClip(f);
      router.push(href(`/post?round=${round?.number ?? ""}${hole ? `&hole=${hole}` : ""}&clip=1&from=course`));
      return;
    }
    stopCamera();
    setClip(f);
  }

  if (!state) return <Loading />;

  if (clip)
    return (
      <ClipDetail
        blob={clip}
        roundId={round?.id ?? null}
        hole={hole}
        onDone={(msg) => toScorecard(msg)}
        onCancel={() => {
          if (confirm("Throw this clip away?")) setClip(null);
        }}
      />
    );

  return (
    <div className="cam">
      <video ref={preview} className="cam-view" muted playsInline autoPlay />
      <div className="cam-top">
        <button className="cam-btn" onClick={() => (stopCamera(), toScorecard())}>
          ‹ Scorecard
        </button>
        <span className="cam-where">
          {round ? `R${round.number}` : ""}
          {hole ? ` · Hole ${hole}` : ""}
        </span>
      </div>

      {phase === "failed" ? (
        <div className="cam-failed">
          <p>The camera didn&apos;t open here. Use the phone&apos;s camera instead, or pick a clip you&apos;ve already filmed.</p>
          <label className="btn block cam-alt">
            Use the phone&apos;s camera
            <input type="file" accept="video/*" capture="environment" hidden onChange={(e) => picked(e.target.files?.[0])} />
          </label>
          <label className="btn secondary block cam-alt">
            Choose from camera roll
            <input type="file" accept="video/*" hidden onChange={(e) => picked(e.target.files?.[0])} />
          </label>
          <button className="btn secondary block cam-alt" onClick={startCamera}>
            Try the camera again
          </button>
        </div>
      ) : (
        <div className="cam-bottom">
          <label className="cam-side">
            Camera roll
            <input type="file" accept="video/*" hidden onChange={(e) => picked(e.target.files?.[0])} />
          </label>
          <button
            className={`cam-rec${phase === "recording" ? " on" : ""}`}
            aria-label={phase === "recording" ? "Stop recording" : "Start recording"}
            disabled={phase === "starting"}
            onClick={toggle}
          >
            <span />
          </button>
          <span className="cam-time" aria-live="polite">
            {phase === "recording" ? `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}` : phase === "starting" ? "Opening…" : "Tap to record"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RecordInner />
    </Suspense>
  );
}
