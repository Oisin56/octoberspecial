"use client";

/**
 * The camera, switched off the moment it isn't needed (no battery drain, no camera light left on).
 * A second request while it's still opening shares the same camera.
 */

let current: MediaStream | null = null;
let opening: Promise<MediaStream> | null = null;

const live = (s: MediaStream | null): s is MediaStream => !!s && s.getVideoTracks().some((t) => t.readyState === "live");

/** The camera (and microphone), opening it only if it isn't already open. */
export async function getCamera(): Promise<MediaStream> {
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

/** Finished with the camera: it switches off straight away. */
export function releaseCamera() {
  stopCamera();
}

/** Switch the camera off now. */
export function stopCamera() {
  current?.getTracks().forEach((t) => t.stop());
  current = null;
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

/** Opened from the home screen (no Safari address bar) */
export const isHomeScreenApp = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
