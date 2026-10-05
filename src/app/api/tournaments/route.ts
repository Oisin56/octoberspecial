import { adminClient } from "@/lib/admin";
import { checkOwnerPin, hashPin, isOwner, setOwner, setSession } from "@/lib/auth";
import { bad, json, slugify } from "@/lib/server-data";

/** Create a new tournament. Only the site owner can (owner PIN = ORGANISER_PIN env). */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!(await isOwner())) {
    if (!b.ownerPin || !checkOwnerPin(String(b.ownerPin))) return bad("Site owner PIN needed to create a tournament", 401);
    await setOwner();
  }
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return bad("Give the tournament a name");
  const organiserPin = String(b.organiserPin ?? "").trim();
  if (!/^\d{4,8}$/.test(organiserPin)) return bad("Organiser PIN must be 4–8 digits");
  let slug = slugify(b.slug || name) || "tournament";
  const db = adminClient();
  const { data: clash } = await db.from("tournaments").select("id").eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await db
    .from("tournaments")
    .insert({
      slug,
      name,
      subtitle: b.subtitle ? String(b.subtitle).slice(0, 120) : null,
      organiser_pin_hash: hashPin(organiserPin),
      published: false,
    })
    .select("id,slug")
    .single();
  if (error) return bad(error.message, 500);
  await setSession(data.id, { role: "organiser", name: "Organiser" });
  return json({ slug: data.slug });
}

export async function GET() {
  const { data } = await adminClient()
    .from("public_tournaments")
    .select("slug,name,subtitle,start_date,end_date,published")
    .order("created_at", { ascending: false });
  return json({ tournaments: data ?? [] });
}
