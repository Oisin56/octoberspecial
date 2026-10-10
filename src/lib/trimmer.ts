"use client";

/**
 * Cuts a section out of a phone video without re-encoding (fast, full quality).
 * The original is read in place (WORKERFS), so even a 10-minute 600 MB recording
 * never has to fit in memory: only the parts around the cut are read.
 * Decoding starts at the keyframe before the cut, but an edit list in the file tells
 * players to start exactly at the mark (minus a 0.5s pad), so cuts are precise even
 * for HEVC files with keyframes several seconds apart.
 */

type FF = {
  load: (o: { coreURL: string; wasmURL: string }) => Promise<boolean>;
  exec: (args: string[]) => Promise<number>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  deleteFile: (name: string) => Promise<boolean>;
  mount: (type: string, opts: { files: File[] }, point: string) => Promise<boolean>;
  unmount: (point: string) => Promise<boolean>;
  createDir: (p: string) => Promise<boolean>;
  on: (ev: "log" | "progress", cb: (e: { message?: string; progress?: number }) => void) => void;
};

let loading: Promise<FF> | null = null;
let logSink: ((m: string) => void) | null = null;
let busy: Promise<unknown> = Promise.resolve();

/** Download (once, then cached by the browser) and start the video tools. */
export function getTrimmer(): Promise<FF> {
  loading ??= (async () => {
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/ffmpeg/index.js" as string);
    const ff = new mod.FFmpeg() as FF;
    await ff.load({ coreURL: "/ffmpeg/core/ffmpeg-core.js", wasmURL: "/ffmpeg/core/ffmpeg-core.wasm" });
    ff.on("log", (e) => logSink?.(e.message ?? ""));
    return ff;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

export function trimmerReady() {
  return loading != null;
}

/** Warm the browser cache so the trimmer works later without a big download. */
export async function prefetchTrimmer(onProgress?: (done: number, total: number) => void) {
  const files = ["/ffmpeg/index.js", "/ffmpeg/classes.js", "/ffmpeg/worker.js", "/ffmpeg/const.js", "/ffmpeg/errors.js", "/ffmpeg/utils.js", "/ffmpeg/core/ffmpeg-core.js", "/ffmpeg/core/ffmpeg-core.wasm"];
  let done = 0;
  for (const f of files) {
    const r = await fetch(f, { cache: "force-cache" });
    if (!r.ok) throw new Error(`Couldn't download ${f}`);
    await r.arrayBuffer();
    onProgress?.(++done, files.length);
  }
  try {
    localStorage.setItem("os_trimmer_cached", "1");
  } catch {}
}

export function trimmerCached() {
  try {
    return localStorage.getItem("os_trimmer_cached") === "1";
  } catch {
    return false;
  }
}

let mountN = 0;

/** Cut [start, end] seconds from the file. Returns an MP4 that plays on iPhone and Android. */
export async function cutClip(file: File, start: number, end: number): Promise<Blob> {
  const run = async () => {
    const ff = await getTrimmer();
    const point = `/in${++mountN}`;
    const ext = (file.name.split(".").pop() || "mov").toLowerCase().replace(/[^a-z0-9]/g, "") || "mov";
    const src = new File([file], `src.${ext}`, { type: file.type }); // same data, safe name; no copy
    await ff.createDir(point).catch(() => true);
    await ff.mount("WORKERFS", { files: [src] }, point);
    const out = `/cut${mountN}.mp4`;
    let hevc = false;
    const lines: string[] = [];
    logSink = (m) => {
      if (/Stream #0:\d.*Video: hevc/i.test(m)) hevc = true;
      lines.push(m);
      if (lines.length > 30) lines.shift();
    };
    try {
      // Probe (prints stream info) so we know whether to tag HEVC for Apple players
      await ff.exec(["-hide_banner", "-i", `${point}/${src.name}`]);
      const from = Math.max(0, start - 0.5);
      const len = Math.max(0.5, end - start + 1);
      const args = [
        "-hide_banner",
        "-ss", from.toFixed(2),
        "-i", `${point}/${src.name}`,
        "-t", len.toFixed(2),
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c", "copy",
        ...(hevc ? ["-tag:v", "hvc1"] : []),
        "-movflags", "+faststart",
        out,
      ];
      const code = await ff.exec(args);
      if (code !== 0) throw new Error(`The video couldn't be cut (${lines.slice(-3).join(" / ")})`);
      const data = await ff.readFile(out);
      await ff.deleteFile(out).catch(() => true);
      return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
    } finally {
      logSink = null;
      await ff.unmount(point).catch(() => true);
    }
  };
  // One cut at a time (ffmpeg is single-threaded)
  const p = busy.then(run, run);
  busy = p.catch(() => undefined);
  return p;
}

// ------------------------------------------------------------ offline queue for clips

export interface PendingClip {
  id: string;
  slug: string;
  blob: Blob;
  filename: string;
  meta: Record<string, unknown>; // post fields: roundId, hole, body, tags, playerIds, clipStart, clipEnd
  at: number;
}

const DB = "os_media_queue";
const STORE = "clips";

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

export async function queueClip(c: PendingClip) {
  await tx("readwrite", (s) => s.put(c));
  window.dispatchEvent(new Event("os-clip-queue"));
}

export async function pendingClips(slug?: string): Promise<PendingClip[]> {
  try {
    const all = (await tx("readonly", (s) => s.getAll())) as PendingClip[];
    return all.filter((c) => !slug || c.slug === slug).sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

async function removeClip(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  window.dispatchEvent(new Event("os-clip-queue"));
}

/** Upload one clip and create its post. Throws "offline" when there's no connection. */
export async function sendClip(c: Omit<PendingClip, "id" | "at">, onProgress?: (p: number) => void) {
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: c.slug, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error ?? `Failed (${r.status})`), { status: r.status });
    return j;
  };
  const up = await post("/api/upload-url", { filename: c.filename, contentType: "video/mp4" });
  await new Promise<void>((ok, fail) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", up.signedUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? ok() : fail(Object.assign(new Error(`Upload failed (${xhr.status})`), { status: xhr.status })));
    xhr.onerror = () => fail(new Error("offline"));
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", c.blob, c.filename);
    xhr.send(fd);
  });
  await uploadPoster(c.slug, up.path, c.blob);
  return post("/api/posts", { ...c.meta, kind: "video", mediaPath: up.path });
}

/** A still frame (about half a second in) from a video file, as a JPEG no wider than 720px. Null if it can't be read. */
export async function posterFrom(blob: Blob): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  const wait = (ev: string) =>
    new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 8000);
      v.addEventListener(ev, () => (clearTimeout(t), res(true)), { once: true });
      v.addEventListener("error", () => (clearTimeout(t), res(false)), { once: true });
    });
  try {
    if (!(await wait("loadedmetadata")) || !v.videoWidth) return null;
    v.currentTime = Math.min(0.5, Number.isFinite(v.duration) ? v.duration / 2 : 0.5);
    if (!(await wait("seeked"))) return null;
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    return await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), "image/jpeg", 0.78));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save a still frame next to an uploaded video (<path>.jpg). Best effort: a clip without one still plays. */
export async function uploadPoster(slug: string, videoPath: string, video: Blob) {
  try {
    const jpg = await posterFrom(video);
    if (jpg) await sendPoster(slug, videoPath, jpg);
  } catch {
    /* no poster is fine */
  }
}

/** Save a still next to a posted video (used behind the film's title cards and as the feed's first frame). */
export async function sendPoster(slug: string, videoPath: string, jpg: Blob) {
  try {
    const r = await fetch("/api/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: slug, contentType: "image/jpeg", filename: "poster.jpg", posterFor: videoPath }) });
    const up = await r.json().catch(() => ({}));
    if (!r.ok || !up.signedUrl) return;
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", jpg, "poster.jpg");
    await fetch(up.signedUrl, { method: "PUT", body: fd, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "true" } });
  } catch {
    /* no poster is fine */
  }
}

let flushing = false;

/** Send any clips waiting for signal. Returns how many are still waiting. */
export async function flushClips(slug: string): Promise<{ left: number; error?: string }> {
  if (flushing) return { left: (await pendingClips(slug)).length };
  flushing = true;
  let error: string | undefined;
  try {
    for (const c of await pendingClips(slug)) {
      try {
        await sendClip(c);
        await removeClip(c.id);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403) {
          error = "Log in again to send the clips waiting on this phone.";
          break; // keep them: logging in fixes it
        } else if (status && status >= 400 && status < 500) {
          error = (e as Error).message;
          await removeClip(c.id); // rejected for good: don't retry forever
        } else break; // offline or server trouble: try later
      }
    }
  } finally {
    flushing = false;
  }
  return { left: (await pendingClips(slug)).length, error };
}

// Exposed for diagnostics and automated tests
if (typeof window !== "undefined") (window as unknown as { __osTrim: unknown }).__osTrim = { cutClip, getTrimmer };
