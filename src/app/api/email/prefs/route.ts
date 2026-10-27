import { getAccount } from "@/lib/auth";
import { emailKey, readKey } from "@/lib/mail/tokens";
import { prefsFor, setPrefs, stopEverything, stopScope, type PrefsPatch } from "@/lib/mail/prefs";
import { bad, crossSite, CROSS_SITE, json } from "@/lib/server-data";
import { adminClient } from "@/lib/admin";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * The email preferences page. Opened from a link in an email (signed for that address, so no sign-in), or from My golf
 * when signed in.
 *   mine                       signed in: a key for my own preferences
 *   load    {k}                what they get now, and what the link they came from would stop
 *   save    {k, patch}         switches changed
 *   stop    {k}                stop what the link was for
 *   stopAll {k}                everything except what they need to sign in
 */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  if (b.action === "mine") {
    const a = await getAccount();
    if (!a) return bad("Sign in first", 401);
    return json({ k: emailKey(a.email, "p") });
  }
  const k = readKey(typeof b.k === "string" ? b.k : null);
  if (!k) return bad("That link isn't complete. Open it from the email again.", 400);
  const who = { email: k.email, role: "person" as const };
  switch (b.action) {
    case "load": {
      const prefs = await prefsFor(k.email);
      let stops: { scope: string; what: string } | null = null;
      if (k.scope === "m") stops = { scope: "m", what: "news and offers from MyGolfBroadcast" };
      else if (k.scope === "t") stops = { scope: "t", what: "tips for running your tournament" };
      else if (k.scope.startsWith("u:")) {
        const { data: t } = await adminClient().from("tournaments").select("name").eq("id", k.scope.slice(2)).maybeSingle();
        stops = { scope: k.scope, what: `emails about ${t?.name ?? "that tournament"}` };
      }
      return json({ prefs, stops });
    }
    case "save": {
      const p = (b.patch ?? {}) as Record<string, unknown>;
      const patch: PrefsPatch = {};
      for (const f of ["tripNews", "offers", "tips"] as const) if (typeof p[f] === "boolean") patch[f] = p[f] as boolean;
      if (Array.isArray(p.tournaments))
        patch.tournaments = (p.tournaments as Record<string, unknown>[])
          .slice(0, 200)
          .filter((x) => typeof x.id === "string" && typeof x.on === "boolean")
          .map((x) => ({ id: String(x.id), on: !!x.on, ...(typeof x.evening === "boolean" ? { evening: x.evening } : {}) }));
      await setPrefs(k.email, patch);
      await logActivity(who, "email.prefs", { person: k.email, detail: { ...patch } });
      return json({ prefs: await prefsFor(k.email) });
    }
    case "stop": {
      if (k.scope === "p") return bad("Nothing to stop from this link");
      await stopScope(k.email, k.scope, k.send);
      await logActivity(who, "email.unsubscribe", { person: k.email, detail: { scope: k.scope } });
      return json({ prefs: await prefsFor(k.email) });
    }
    case "stopAll": {
      await stopEverything(k.email);
      await logActivity(who, "email.stopall", { person: k.email });
      return json({ prefs: await prefsFor(k.email) });
    }
  }
  return bad("Unknown action");
}
