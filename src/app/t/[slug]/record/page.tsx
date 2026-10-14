"use client";

import { grabClipFix } from "@/lib/clipFix";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { ClipDetail } from "@/components/ClipDetail";
import { setPendingClip, takePendingClip } from "@/lib/pendingClip";
import { mergeShots } from "@/lib/shotQueue";
import { getCamera, isHomeScreenApp, isIPhone, nativeZoom, releaseCamera, setNativeZoom } from "@/lib/camera";

/** In-app recordings up to 3 minutes (several shots can be cut from one) */
const MAX_SECONDS = 180;
/** Warn this long before the limit */
const WARN_SECONDS = 10;
const TIP_KEY = "mgs_camera_tip";
const buzz = (ms: number | number[]) => {
  try {
    navigator.vibrate?.(ms); // Android only: iPhone doesn't let websites vibrate
  } catch {}
};
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
  const { state, href, slug } = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const round = useMemo(() => {
    if (!state) return null;
    const n = sp.get("round");
    return (n && state.rounds.find((r) => r.number === Number(n))) || state.rounds.find((r) => r.status === "live") || null;
  }, [state, sp]);
  const hole = sp.get("hole") ? Number(sp.get("hole")) : null;
  // Filmed from the shot card: the player (and their last shot) are already known
  const prefill = useMemo(() => {
    const player = sp.get("player");
    if (!player || !state || !round || !hole) return null;
    const shots = mergeShots(state.shots, slug, state.tournament.id).filter((s) => s.round_id === round.id && s.hole === hole && s.player_id === player);
    const s = shots.find((x) => x.client_id === sp.get("shot")) ?? shots[shots.length - 1];
    return { playerId: player, kind: s?.kind, outcome: s?.outcome, club: s?.club, shotClientId: s?.client_id };
  }, [sp, state, round, hole, slug]);
  const holeInfo = useMemo(() => {
    const hh = round && hole ? round.holes.find((x) => x.number === hole) : null;
    return hh ? { par: hh.par, yards: hh.yards, note: round?.course_guide?.holes?.[String(hole)] ?? "" } : undefined;
  }, [round, hole]);

  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<"starting" | "ready" | "recording" | "failed">("starting");
  const [secs, setSecs] = useState(0);
  /** Zoom: the camera's own (Android), or digital (iPhone: the picture is enlarged, set before filming) */
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  /** Digital zoom while filming: the enlarged picture is drawn here and recorded */
  const digital = useRef<{ stop: () => void } | null>(null);
  const [tip, setTip] = useState(false);
  const [iphone, setIphone] = useState(false);
  const [homeApp, setHomeApp] = useState(false);
  const [clip, setClip] = useState<Blob | null>(null);
  // Picked in the feed: the clip is handed over, so the camera stays off
  const fromFeed = sp.get("from") === "feed";
  const [waitPending, setWaitPending] = useState(sp.get("clip") === "1");

  /** Done with the camera: it switches off straight away */
  const stopCamera = useCallback(() => {
    if (stream.current) releaseCamera();
    stream.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setPhase("starting");
    // Nothing being typed while filming (on iPhone, moving the phone can offer to "Undo" typing)
    (document.activeElement as HTMLElement | null)?.blur?.();
    try {
      if (!navigator.mediaDevices?.getUserMedia || pickType() === null) throw new Error("no camera here");
      const s = await getCamera();
      stream.current = s;
      if (preview.current) {
        preview.current.srcObject = s;
        await preview.current.play().catch(() => {});
      }
      const range = nativeZoom(s);
      setZoomRange(range);
      setZoom(1);
      if (range) setNativeZoom(s, Math.max(range.min, 1));
      setPhase("ready");
      setIphone(isIPhone());
      setHomeApp(isHomeScreenApp());
      // iPhone: once the camera question has been answered, show how to stop it being asked again
      try {
        if (isIPhone() && !localStorage.getItem(TIP_KEY) && !sessionStorage.getItem(TIP_KEY)) setTip(true);
      } catch {}
    } catch {
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    if (!waitPending) return;
    const f = takePendingClip();
    window.setTimeout(() => {
      if (f) picked(f as File);
      setWaitPending(false);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (clip || waitPending) return;
    startCamera();
    return () => stopCamera();
  }, [clip, waitPending, startCamera, stopCamera]);

  // Stop automatically at the limit (with a buzz and a warning 10 seconds before)
  useEffect(() => {
    if (phase !== "recording") return;
    const t0 = Date.now();
    let warned = false;
    const i = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      setSecs(s);
      if (!warned && s >= MAX_SECONDS - WARN_SECONDS) {
        warned = true;
        buzz([100, 80, 100]);
      }
      if (s >= MAX_SECONDS) rec.current?.stop();
    }, 200);
    return () => clearInterval(i);
  }, [phase]);

  /** What gets recorded: the camera, or (digital zoom) the enlarged picture plus the camera's sound */
  function source(s: MediaStream): MediaStream {
    const v = preview.current;
    if (zoomRange || zoom <= 1 || !v?.videoWidth || typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) return s;
    const W = v.videoWidth;
    const H = v.videoHeight;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    if (!g) return s;
    const cw = W / zoom;
    const ch = H / zoom;
    let on = true;
    const draw = () => {
      if (!on) return;
      g.drawImage(v, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, W, H);
      requestAnimationFrame(draw);
    };
    draw();
    const out = (c as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(30);
    s.getAudioTracks().forEach((t) => out.addTrack(t));
    digital.current = {
      stop: () => {
        on = false;
        out.getVideoTracks().forEach((t) => t.stop());
      },
    };
    return out;
  }

  function toggle() {
    if (phase === "recording") {
      buzz(60);
      return rec.current?.stop();
    }
    if (!stream.current) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const type = pickType() || undefined;
    const r = new MediaRecorder(source(stream.current), { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 1_800_000, audioBitsPerSecond: 96_000 });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: (r.mimeType || type || "video/mp4").split(";")[0] });
      digital.current?.stop();
      digital.current = null;
      stopCamera();
      setPhase("ready");
      setClip(blob);
    };
    rec.current = r;
    r.start(500);
    grabClipFix();
    buzz(120);
    setSecs(0);
    setPhase("recording");
  }

  /** Zoom to a level: the camera's own zoom where there is one, else the picture is enlarged */
  function zoomTo(z: number) {
    const lo = zoomRange ? zoomRange.min : 1;
    const hi = zoomRange ? Math.min(zoomRange.max, 8) : 3;
    const v = Math.max(lo, Math.min(hi, Math.round(z * 10) / 10));
    setZoom(v);
    if (zoomRange) setNativeZoom(stream.current, v);
  }
  // Digital zoom is set before filming (it can't change mid-clip)
  const canZoom = !!zoomRange || phase !== "recording";
  const zoomSteps = zoomRange ? [0.5, 1, 2, 3].filter((z) => z >= zoomRange.min - 0.01 && z <= zoomRange.max + 0.01) : [1, 2, 3];
  const pinchHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 2 || !canZoom) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      pinch.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoom };
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      zoomTo((pinch.current.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) / pinch.current.d);
    },
    onTouchEnd: () => {
      pinch.current = null;
    },
  };
  const left = MAX_SECONDS - secs;
  const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  const toScorecard = (msg?: string) => {
    if (msg) sessionStorage.setItem("mgs_flash", msg);
    router.push(href(fromFeed ? "/feed" : "/score"));
  };

  function picked(f: File | undefined) {
    if (!f) return;
    // Very big files from the camera roll still go through the cutter
    if (f.size > MAX_BYTES) {
      setPendingClip(f);
      router.push(href(`/post?round=${round?.number ?? ""}${hole ? `&hole=${hole}` : ""}&clip=1${fromFeed ? "" : "&from=course"}`));
      return;
    }
    stopCamera();
    setClip(f);
  }

  if (!state || waitPending) return <Loading />;

  if (clip)
    return (
      <ClipDetail
        blob={clip}
        roundId={round?.id ?? null}
        hole={hole}
        holeInfo={holeInfo}
        prefill={prefill}
        backLabel={fromFeed ? "Feed" : "Scorecard"}
        onDone={(msg) => toScorecard(msg)}
        onCancel={() => {
          if (!confirm("Throw this clip away?")) return;
          if (fromFeed) return toScorecard();
          setClip(null);
        }}
      />
    );

  const recording = phase === "recording";
  return (
    <div className={`cam${recording ? " recording" : ""}`} {...pinchHandlers}>
      <video
        ref={preview}
        className="cam-view"
        muted
        playsInline
        autoPlay
        style={!zoomRange && zoom > 1 ? { transform: `scale(${zoom})` } : undefined}
      />
      {recording ? (
        <div className={`cam-rec-banner${left <= WARN_SECONDS ? " warn" : ""}`} role="status">
          <span className="dot" aria-hidden />
          {left <= WARN_SECONDS ? `${Math.ceil(left)} seconds left` : `REC ${clock(secs)}`}
        </div>
      ) : (
        <div className="cam-top">
          <button className="cam-btn" onClick={() => (stopCamera(), toScorecard())}>
            ‹ Scorecard
          </button>
          <span className="cam-where">
            {round ? `R${round.number}` : ""}
            {hole ? ` · Hole ${hole}` : ""}
          </span>
        </div>
      )}

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
        <div className="cam-foot">
          {phase !== "starting" && canZoom && (
            <div className="cam-zoom" role="group" aria-label="Zoom">
              {zoomSteps.map((z) => (
                <button key={z} aria-pressed={Math.abs(zoom - z) < 0.05} onClick={() => zoomTo(z)}>
                  {z === 0.5 ? ".5" : z}×
                </button>
              ))}
              {!zoomSteps.some((z) => Math.abs(zoom - z) < 0.05) && <span className="cam-zoom-now">{zoom.toFixed(1)}×</span>}
            </div>
          )}
          {!recording && iphone && (
            <label className="cam-native">
              More zoom: use the iPhone camera
              <input type="file" accept="video/*" capture="environment" hidden onChange={(e) => picked(e.target.files?.[0])} />
            </label>
          )}
          <div className="cam-bottom">
            {recording ? (
              <span />
            ) : (
              <label className="cam-side">
                Camera roll
                <input type="file" accept="video/*" hidden onChange={(e) => picked(e.target.files?.[0])} />
              </label>
            )}
            <button className={`cam-rec${recording ? " on" : ""}`} aria-label={recording ? "Stop recording" : "Start recording"} disabled={phase === "starting"} onClick={toggle}>
              <span />
            </button>
            <span className="cam-time" aria-live="polite">
              {recording ? "Tap the square to stop" : phase === "starting" ? "Opening…" : "Ready: tap to record"}
            </span>
          </div>
        </div>
      )}

      {tip && !recording && (
        <div className="cam-tip" role="dialog" aria-label="Stop the camera question">
          <p className="cam-tip-h">Stop your iPhone asking every time</p>
          {homeApp ? (
            <ol>
              <li>
                Open the <b>Settings</b> app
              </li>
              <li>
                Tap <b>Apps</b>, then <b>Safari</b> (on older iPhones, Safari is in the main list)
              </li>
              <li>
                Tap <b>Camera</b> and choose <b>Allow</b>. Do the same for <b>Microphone</b>
              </li>
            </ol>
          ) : (
            <ol>
              <li>
                Tap <b>aA</b> (or <b>⋯</b>) beside the web address at the top or bottom of the screen
              </li>
              <li>
                Tap <b>Website Settings</b>
              </li>
              <li>
                Set <b>Camera</b> and <b>Microphone</b> to <b>Allow</b>
              </li>
            </ol>
          )}
          <p className="cam-tip-note">Apple doesn&apos;t let apps in Safari change this for you. It takes 20 seconds, once. If an &ldquo;Undo&rdquo; box ever pops up while filming, that&apos;s Shake to Undo: Settings, Accessibility, Touch turns it off.</p>
          <div className="row">
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => {
                try {
                  localStorage.setItem(TIP_KEY, "1");
                } catch {}
                setTip(false);
              }}
            >
              Done it
            </button>
            <button
              className="btn secondary"
              style={{ flex: 1 }}
              onClick={() => {
                try {
                  sessionStorage.setItem(TIP_KEY, "1");
                } catch {}
                setTip(false);
              }}
            >
              Later
            </button>
          </div>
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
