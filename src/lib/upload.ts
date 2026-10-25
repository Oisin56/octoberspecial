"use client";

import { rememberSigned } from "./supabase";

/** Upload a file straight to storage with a one-time signed URL (asked for with `body`: t, contentType, filename). */
export async function uploadBlob(file: Blob, body: Record<string, unknown>): Promise<string> {
  const r = await fetch("/api/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j.error ?? "Upload failed"));
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", file);
  const up = await fetch(String(j.signedUrl), { method: "PUT", body: fd, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "false" } });
  if (!up.ok) throw new Error("Upload failed");
  // A private tournament's file: the link to show it here straight away
  if (j.readUrl) rememberSigned({ [String(j.path)]: String(j.readUrl) });
  return String(j.path);
}

/** How long a video or sound file plays, read by the browser. */
export function mediaSeconds(file: Blob, kind: "video" | "audio"): Promise<number> {
  return new Promise((ok) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = el.duration;
      URL.revokeObjectURL(url);
      ok(Number.isFinite(d) ? Math.round(d * 10) / 10 : 0);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      ok(0);
    };
    el.src = url;
  });
}
