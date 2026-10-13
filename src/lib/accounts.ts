import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { adminClient } from "./admin";
import type { Session } from "./auth";

/**
 * Organiser accounts: sign in with your email (a one-tap link, no password) and see every tournament you run,
 * on any device. A tournament is added to an account when it's created while signed in, or once by an
 * organiser of it (already logged in as organiser, or with its organiser PIN).
 */
export const LINK_MINUTES = 30;

export const tokenHash = (token: string) => createHash("sha256").update(`mgs-account:${token}`).digest("hex");

export function newToken() {
  return randomBytes(24).toString("base64url");
}

export interface AccountTournament {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  start_date: string | null;
  end_date: string | null;
}

export async function accountTournaments(accountId: string): Promise<AccountTournament[]> {
  const db = adminClient();
  const { data: links } = await db.from("account_tournaments").select("tournament_id").eq("account_id", accountId);
  const ids = (links ?? []).map((l) => l.tournament_id);
  if (!ids.length) return [];
  const { data } = await db.from("public_tournaments").select("id,slug,name,subtitle,start_date,end_date").in("id", ids).order("created_at", { ascending: false });
  return (data ?? []) as AccountTournament[];
}

/** The organiser session for one tournament (named after the organiser's player, if they play). */
export async function organiserSession(tournamentId: string): Promise<Session> {
  const db = adminClient();
  const { data: t } = await db.from("tournaments").select("organiser_player_id").eq("id", tournamentId).maybeSingle();
  if (t?.organiser_player_id) {
    const { data: p } = await db.from("players").select("id,name").eq("id", t.organiser_player_id).maybeSingle();
    if (p) return { role: "organiser", name: p.name, playerId: p.id };
  }
  return { role: "organiser", name: "Organiser" };
}

export async function organiserSessions(accountId: string): Promise<Record<string, Session>> {
  const out: Record<string, Session> = {};
  for (const t of await accountTournaments(accountId)) out[t.id] = await organiserSession(t.id);
  return out;
}

export async function linkTournament(accountId: string, tournamentId: string) {
  await adminClient().from("account_tournaments").upsert({ account_id: accountId, tournament_id: tournamentId }, { onConflict: "account_id,tournament_id" });
}
