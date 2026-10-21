import { isOrganiser } from "@/lib/auth";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { applySetupEdit, validScope } from "@/lib/setup-edit";
import { selfOrigin } from "@/lib/research";
import { WizardError } from "@/lib/wizard-server";

export const maxDuration = 60;

/** Tournament setup: save one screen's answers. Body: { t, scope, wizard } */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!isOrganiser(session)) return bad("Organiser only", 403);
  const scope = String(b.scope ?? "");
  if (!validScope(scope)) return bad("Unknown change");
  try {
    const out = await applySetupEdit(t, b.wizard, scope, selfOrigin(req));
    return json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof WizardError) return bad(e.message);
    console.error("setup-edit", e);
    return bad(e instanceof Error && /column|schema/.test(e.message) ? "This needs the latest database update. Run supabase/schema.sql in Supabase, then try again." : "Couldn't save that. Try again.", 500);
  }
}
