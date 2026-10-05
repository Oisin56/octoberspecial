import { adminClient } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { bad, json } from "@/lib/server-data";

const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm))$/;

/** Returns a one-time signed URL so the phone uploads straight to storage. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return bad("Log in to upload", 401);
  const body = await req.json().catch(() => ({}));
  const type = String(body.contentType ?? "");
  if (!ALLOWED.test(type)) return bad("Photos and videos only");
  const ext = (String(body.filename ?? "").split(".").pop() || type.split("/")[1]).toLowerCase().replace(/[^a-z0-9]/g, "");
  const folder = type.startsWith("video") ? "video" : "photo";
  const path = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await adminClient().storage.from("media").createSignedUploadUrl(path);
  if (error || !data) return bad(error?.message ?? "Upload not available", 500);
  return json({ path, token: data.token, signedUrl: data.signedUrl });
}
