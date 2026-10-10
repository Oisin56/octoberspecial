import { adminClient } from "@/lib/admin";
import { isOwner } from "@/lib/auth";
import { bad, context, json } from "@/lib/server-data";

const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav))$/;

/** One-time signed URL so the phone uploads straight to storage. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { t, session } = await context(req, body);
  if (!session && !(await isOwner())) return bad("Log in to upload", 401);
  const type = String(body.contentType ?? "");
  if (!ALLOWED.test(type)) return bad("Photos, videos or audio only");
  if (type.startsWith("audio") && session?.role !== "organiser" && !(await isOwner())) return bad("Only the organiser can upload music", 403);
  const ext = (String(body.filename ?? "").split(".").pop() || type.split("/")[1]).toLowerCase().replace(/[^a-z0-9]/g, "");
  const folder = type.startsWith("video") ? "video" : type.startsWith("audio") ? "audio" : "photo";
  // A still frame for a video is stored right next to it: <video path>.jpg
  const posterFor = String(body.posterFor ?? "");
  const isPoster = type === "image/jpeg" && new RegExp(`^video/${t?.slug ?? "site"}/[\\w-]+\\.[a-z0-9]+$`).test(posterFor);
  if (body.posterFor && !isPoster) return bad("Bad poster");
  const path = isPoster ? `${posterFor}.jpg` : `${folder}/${t?.slug ?? "site"}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await adminClient().storage.from("media").createSignedUploadUrl(path);
  if (error || !data) return bad(error?.message ?? "Upload not available", 500);
  return json({ path, token: data.token, signedUrl: data.signedUrl });
}
