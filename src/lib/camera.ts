"use client";

/**
 * One camera for the whole visit. Opening the camera is what makes the phone ask for permission, so instead of
 * switching it off every time the record screen closes, it's kept ready between clips while the app is open,
 * and switched off after a few idle minutes (or when the phone puts the app away) to save battery.
 */
const IDLE_MS = 3 * 60_000;

let current: MediaStream | null = null;
let opening: Promise<MediaStream> | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

const live = (s: MediaStream | null): s is MediaStream => !!s && s.getVideoTracks().some((t) => t.readyState === "live");

/** The camera (and microphone), opening it only if it isn't already open. */
export async function getCamera(): Promise<MediaStream> {
  if (idle) clearTimeout(idle);
  idle = null;
  if (live(current)) return current;
  if (opening) return opening;
  opening = navigator.mediaDevices
    .getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: { noiseSuppression: true, echoCancellation: false },
    })
    .then((s) => {
      current = s;
      return s;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

/** Finished with the camera for now: it stays ready for the next clip, then switches off. */
export function releaseCamera(after = IDLE_MS) {
  if (idle) clearTimeout(idle);
  idle = setTimeout(stopCamera, after);
}

/** Switch the camera off now. */
export function stopCamera() {
  if (idle) clearTimeout(idle);
  idle = null;
  current?.getTracks().forEach((t) => t.stop());
  current = null;
}

// The phone puts the app away (locked, another app): the camera goes off, like any camera app
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && current) releaseCamera(20_000);
  });
}

/** Zoom the camera can do by itself (most Android phones in Chrome). iPhone doesn't let websites zoom. */
export function nativeZoom(s: MediaStream | null): { min: number; max: number } | null {
  const t = s?.getVideoTracks()[0];
  const caps = (t?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number } };
  if (!caps.zoom || !(caps.zoom.max > caps.zoom.min)) return null;
  return { min: caps.zoom.min, max: caps.zoom.max };
}

export async function setNativeZoom(s: MediaStream | null, zoom: number) {
  const t = s?.getVideoTracks()[0];
  if (!t) return;
  await t.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] }).catch(() => {});
}

export const isIPhone = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
