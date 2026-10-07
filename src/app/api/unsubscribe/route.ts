import { adminClient } from "@/lib/admin";

const UUID = /^[0-9a-f-]{36}$/i;

async function unsubscribe(token: string | null) {
  if (!token || !UUID.test(token)) return null;
  const { data } = await adminClient()
    .from("subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("token", token)
    .select("tournament_id")
    .maybeSingle();
  if (!data) return null;
  const { data: t } = await adminClient().from("tournaments").select("name,slug").eq("id", data.tournament_id).single();
  return t;
}

const page = (msg: string, link?: string) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font-family:Georgia,serif;max-width:520px;margin:60px auto;padding:0 16px;color:#18231d"><h1 style="font-family:Arial Narrow,Arial,sans-serif">${msg}</h1>${link ? `<p><a href="${link}">Back to the site</a></p>` : ""}</body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

/** Link in every email: one tap and you're off the list. */
export async function GET(req: Request) {
  const t = await unsubscribe(new URL(req.url).searchParams.get("token"));
  if (!t) return page("That link has expired or was already used.");
  const name = t.name.replace(/[<>&"]/g, "");
  return page(`You're unsubscribed from ${name}.`, `/t/${t.slug}`);
}

/** One-click unsubscribe from mail apps (List-Unsubscribe-Post). */
export async function POST(req: Request) {
  await unsubscribe(new URL(req.url).searchParams.get("token"));
  return new Response(null, { status: 204 });
}
