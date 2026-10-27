import "server-only";
import { adminClient } from "../admin";
import type { Scope } from "./tokens";

/**
 * What each person has chosen to get, kept on their row in people (one per email). Marketing needs their tick (with
 * the words they saw, and when); within it they can turn the series and the campaigns off separately. Tips are for
 * organisers. Each tournament's updates are their sign-up for it (subscribers). Service emails can't be turned off.
 */

export const PREFS_WORDS = {
  tripNews: "Trip news, such as A year ago today",
  offers: "News and offers from MyGolfBroadcast",
} as const;

export interface Prefs {
  email: string;
  name: string | null;
  marketing: boolean;
  tripNews: boolean;
  offers: boolean;
  tips: boolean;
  organiser: boolean;
  stoppedReason: string | null;
  updatesStopped: boolean;
  tournaments: { id: string; name: string; slug: string; on: boolean; evening: boolean }[];
}

async function ensurePerson(email: string) {
  await adminClient().rpc("touch_person", { e: email, nm: null, role: null, seen: null, since: null }).then(
    () => null,
    () => null,
  );
}

export async function prefsFor(email: string): Promise<Prefs> {
  const db = adminClient();
  const e = email.trim().toLowerCase();
  const [{ data: p }, { data: subs }] = await Promise.all([
    db.from("people").select("*").eq("email", e).maybeSingle(),
    db.from("subscribers").select("tournament_id,unsubscribed_at,evening").eq("email", e),
  ]);
  const ids = [...new Set((subs ?? []).map((s) => s.tournament_id))];
  const { data: ts } = ids.length ? await db.from("tournaments").select("id,name,slug").in("id", ids) : { data: [] };
  const roles: string[] = p?.roles ?? [];
  const marketing = !!p?.marketing_at && !p?.marketing_stopped_at;
  return {
    email: e,
    name: p?.name ?? null,
    marketing,
    tripNews: marketing && p?.trip_news !== false,
    offers: marketing && p?.offers !== false,
    tips: p?.tips !== false,
    organiser: roles.includes("organiser"),
    stoppedReason: p?.marketing_stopped_reason ?? null,
    updatesStopped: !!p?.updates_stopped_at,
    tournaments: (ts ?? [])
      .map((t) => {
        const s = (subs ?? []).find((x) => x.tournament_id === t.id)!;
        return { id: t.id, name: t.name, slug: t.slug, on: !s.unsubscribed_at && !p?.updates_stopped_at, evening: !!s.evening };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A tick in a form (a follower's, an organiser's): marketing starts, with the words they saw. */
export async function recordMarketing(email: string, tournamentId: string | null, wording: string, at = new Date().toISOString(), opts: { onlyIfNewer?: boolean } = {}) {
  const e = email.trim().toLowerCase();
  await ensurePerson(e);
  if (opts.onlyIfNewer) {
    // A tick kept from earlier never overrides a later stop, or a spam complaint
    const { data: p } = await adminClient().from("people").select("marketing_stopped_at,marketing_stopped_reason,marketing_at").eq("email", e).maybeSingle();
    if (p?.marketing_stopped_reason === "spam") return;
    const t = (x: string) => Date.parse(x);
    if (p?.marketing_stopped_at && t(p.marketing_stopped_at) > t(at)) return;
    if (p?.marketing_at && t(p.marketing_at) > t(at) && !p.marketing_stopped_at) return;
  }
  await adminClient()
    .from("people")
    .update({ marketing_at: at, marketing_wording: wording, marketing_tournament: tournamentId, marketing_stopped_at: null, marketing_stopped_reason: null, trip_news: true, offers: true })
    .eq("email", e);
}

export interface PrefsPatch {
  tripNews?: boolean;
  offers?: boolean;
  tips?: boolean;
  tournaments?: { id: string; on: boolean; evening?: boolean }[];
}

/** Changes from the preferences page. Turning marketing on there is their tick, kept with the switch's words. */
export async function setPrefs(email: string, patch: PrefsPatch) {
  const db = adminClient();
  const e = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const before = await prefsFor(e);
  await ensurePerson(e);
  const row: Record<string, unknown> = {};
  if (patch.tips !== undefined) row.tips = patch.tips;
  const wantNews = patch.tripNews ?? before.tripNews;
  const wantOffers = patch.offers ?? before.offers;
  if (patch.tripNews !== undefined || patch.offers !== undefined) {
    if ((wantNews || wantOffers) && !before.marketing) {
      const words = [wantNews ? PREFS_WORDS.tripNews : null, wantOffers ? PREFS_WORDS.offers : null].filter(Boolean).join("; ");
      Object.assign(row, { marketing_at: now, marketing_wording: `Turned on in email preferences: ${words}`, marketing_tournament: null, marketing_stopped_at: null, marketing_stopped_reason: null });
    }
    if (!wantNews && !wantOffers && before.marketing) Object.assign(row, { marketing_stopped_at: now, marketing_stopped_reason: "unsubscribed" });
    Object.assign(row, { trip_news: wantNews, offers: wantOffers });
  }
  if (Object.keys(row).length) await db.from("people").update(row).eq("email", e);
  for (const t of patch.tournaments ?? []) {
    const mine = before.tournaments.find((x) => x.id === t.id);
    if (!mine) continue;
    await db
      .from("subscribers")
      .update({ unsubscribed_at: t.on ? null : now, ...(t.evening !== undefined ? { evening: t.evening } : {}) })
      .eq("tournament_id", t.id)
      .eq("email", e);
    // Turning a tournament back on is asking for updates again
    if (t.on && before.updatesStopped) await db.from("people").update({ updates_stopped_at: null }).eq("email", e);
  }
}

/** One tap on "Stop these emails" (or the mail app's unsubscribe button). */
export async function stopScope(email: string, scope: Scope, sendId: string | null) {
  const db = adminClient();
  const e = email.trim().toLowerCase();
  const now = new Date().toISOString();
  if (scope === "m") await db.from("people").update({ marketing_stopped_at: now, marketing_stopped_reason: "unsubscribed" }).eq("email", e).is("marketing_stopped_at", null);
  else if (scope === "t") await db.from("people").update({ tips: false }).eq("email", e);
  else if (scope.startsWith("u:")) await db.from("subscribers").update({ unsubscribed_at: now }).eq("tournament_id", scope.slice(2)).eq("email", e).is("unsubscribed_at", null);
  if (sendId) await db.from("email_sends").update({ stopped_at: now }).eq("id", sendId).eq("email", e).is("stopped_at", null);
}

/** Everything but what they need to sign in. */
export async function stopEverything(email: string, reason: "unsubscribed" | "spam" = "unsubscribed") {
  const db = adminClient();
  const e = email.trim().toLowerCase();
  const now = new Date().toISOString();
  await ensurePerson(e);
  const { data: p } = await db.from("people").select("marketing_stopped_at").eq("email", e).maybeSingle();
  await db
    .from("people")
    .update({ tips: false, updates_stopped_at: now, ...(p?.marketing_stopped_at && reason !== "spam" ? {} : { marketing_stopped_at: now, marketing_stopped_reason: reason }) })
    .eq("email", e);
  await db.from("subscribers").update({ unsubscribed_at: now }).eq("email", e).is("unsubscribed_at", null);
}
