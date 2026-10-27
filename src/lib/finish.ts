import "server-only";
import { adminClient } from "./admin";
import { logActivity, SYSTEM, type Actor } from "./activity";
import { writeEndPiece } from "./ai";
import { recordError } from "./incidents";
import { dublinToday } from "./mail/limits";
import { loadServerState } from "./server-data";
import { toEntries, toTournamentCfg } from "./types";
import { tournamentSummary } from "./engine";

/**
 * The end of a trip. A group tournament finishes when an organiser taps Finish tournament, or by itself 3 days after
 * its last round (organisers get an email the day before). A round on your own finishes when its last hole is saved,
 * or by itself the day after. Finishing closes scoring for players, keeps the feed open 30 days, turns the home page
 * into the trip page and writes the final report (or, on your own, the write-up).
 */

export const FEED_DAYS = 30;

export const FINISHED_ASK = "This tournament is finished. Change this score?";
/** A finished tournament: the organiser is asked first, then sends it again with confirmFinished */
export const finishedAsk = () => Response.json({ error: FINISHED_ASK, finished: true }, { status: 409 });
export const FINISHED_PLAYER = "This tournament is finished, so scores can't be changed now. Ask the organiser if something's wrong.";
/** How long after finishing the organiser can open scoring again */
export const REOPEN_DAYS = 30;
const DAY = 864e5;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The day it finishes by itself: 3 days after the last round (the day after, on your own), or as long after opening scoring again. */
export function autoFinishDay(t: { solo?: boolean | null; reopened_at?: string | null }, lastDay: string | null): string | null {
  if (!lastDay) return null;
  const wait = t.solo ? 1 : 3;
  let day = addDays(lastDay, wait);
  if (t.reopened_at) {
    const again = addDays(dublinToday(new Date(t.reopened_at)), wait);
    if (again > day) day = again;
  }
  return day;
}

/**
 * Finish it now. Every round still open is closed (kept in finish_rounds, to put back if scoring is opened again).
 * Returns false if it had already finished.
 */
export async function finishTournament(tid: string, by: { name: string; actor?: Actor }, opts: { write?: boolean } = {}): Promise<boolean> {
  const db = adminClient();
  const { data: open } = await db.from("rounds").select("id").eq("tournament_id", tid).neq("status", "complete");
  const now = new Date();
  const { data: t } = await db
    .from("tournaments")
    .update({ finished_at: now.toISOString(), finished_by: by.name, feed_until: new Date(now.getTime() + FEED_DAYS * DAY).toISOString(), finish_rounds: (open ?? []).map((r) => r.id) })
    .eq("id", tid)
    .is("finished_at", null)
    .select("id,name")
    .maybeSingle();
  if (!t) return false;
  if (open?.length) await db.from("rounds").update({ status: "complete" }).in("id", open.map((r) => r.id));
  await logActivity(by.actor ?? SYSTEM, "tournament.finished", { tournamentId: tid, tournamentName: t.name, detail: { by: by.name } });
  if (opts.write !== false) {
    try {
      await endPiece(tid);
    } catch (e) {
      // Tried again by the next end-of-trip run
      console.error("[finish] end piece", e);
    }
  }
  return true;
}

/** Write the final report or the write-up, once, and note that it's been done (or wasn't wanted). */
export async function endPiece(tid: string) {
  const r = await writeEndPiece(tid);
  await adminClient().from("tournaments").update({ end_piece: r }).eq("id", tid);
  return r;
}

/** On your own: a round with every hole in is done, and once every round is, it's finished (and the write-up written). */
export async function maybeFinishSolo(tid: string): Promise<boolean> {
  const s = await loadServerState(tid);
  if (!s.tournament.solo || s.tournament.finished_at || !s.rounds.length) return false;
  const sum = tournamentSummary(toTournamentCfg(s), toEntries(s.entries));
  // Each round with every hole in is done (there's no card to hand in on your own)
  const done = s.rounds.filter((r, i) => sum.rounds[i]?.complete && r.status !== "complete").map((r) => r.id);
  if (done.length) await adminClient().from("rounds").update({ status: "complete" }).in("id", done);
  if (!sum.rounds.every((r) => r.complete)) return false;
  const finished = await finishTournament(tid, { name: "Finished when the last hole was saved" }, { write: false });
  if (finished) await endPiece(tid).catch((e) => console.error("[finish] write-up", e));
  return finished;
}

/** Open scoring again (within 30 days of finishing): the rounds the finish closed go back as they were. */
export async function reopenTournament(tid: string, by: { name: string; actor?: Actor }): Promise<"ok" | "not-finished" | "too-late"> {
  const db = adminClient();
  const { data: t } = await db.from("tournaments").select("id,name,finished_at,finish_rounds").eq("id", tid).maybeSingle();
  if (!t?.finished_at) return "not-finished";
  if (Date.now() - Date.parse(t.finished_at) > REOPEN_DAYS * DAY) return "too-late";
  const { data: done } = await db
    .from("tournaments")
    .update({ finished_at: null, finished_by: null, feed_until: null, finish_rounds: null, reopened_at: new Date().toISOString(), finish_warned_at: null })
    .eq("id", tid)
    .eq("finished_at", t.finished_at)
    .select("id")
    .maybeSingle();
  if (!done) return "not-finished";
  const ids = (Array.isArray(t.finish_rounds) ? t.finish_rounds : []).map(String);
  if (ids.length) {
    const { data: scored } = await db.from("hole_entries").select("round_id").in("round_id", ids);
    const live = new Set((scored ?? []).map((x) => x.round_id as string));
    const liveIds = ids.filter((id) => live.has(id));
    const upcoming = ids.filter((id) => !live.has(id));
    if (liveIds.length) await db.from("rounds").update({ status: "live" }).in("id", liveIds);
    if (upcoming.length) await db.from("rounds").update({ status: "upcoming" }).in("id", upcoming);
  }
  await logActivity(by.actor ?? SYSTEM, "tournament.reopened", { tournamentId: tid, tournamentName: t.name, detail: { by: by.name } });
  return "ok";
}

/** The feed: close it now, or open it again for another 30 days */
export async function setFeed(tid: string, open: boolean) {
  const until = open ? new Date(Date.now() + FEED_DAYS * DAY).toISOString() : new Date().toISOString();
  const { error } = await adminClient().from("tournaments").update({ feed_until: until }).eq("id", tid).not("finished_at", "is", null);
  if (error) throw new Error(error.message);
  return until;
}

export interface Candidate {
  id: string;
  name: string;
  slug: string;
  theme: string;
  custom_colors: unknown;
  solo: boolean;
  reopened_at: string | null;
  finish_warned_at: string | null;
  last_day: string | null;
}

/** Unfinished tournaments whose last round was before today */
export async function unfinishedPast(today = dublinToday()): Promise<Candidate[]> {
  const db = adminClient();
  const out: Candidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc("finish_candidates", { today }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Candidate[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** The end-of-trip work (twice a day): finish what's due, then write any end pieces still missing (within the time given). */
export async function runFinishing(deadline: number): Promise<{ finished: number; written: number }> {
  const today = dublinToday();
  let finished = 0;
  for (const c of await unfinishedPast(today)) {
    const due = autoFinishDay(c, c.last_day);
    if (!due || due > today) continue;
    // Quietly: writing happens below, one at a time, within the run's time
    if (await finishTournament(c.id, { name: "Finished by itself after the last round" }, { write: false })) finished++;
  }
  let written = 0;
  const db = adminClient();
  const since = new Date(Date.now() - 3 * DAY).toISOString();
  const { data: recent } = await db.from("tournaments").select("id").gte("finished_at", since).is("end_piece", null).order("finished_at").limit(200);
  for (const t of recent ?? []) {
    if (Date.now() > deadline) break;
    try {
      if ((await endPiece(t.id)) === "written") written++;
    } catch (e) {
      await recordError("end of trip: writing", e, { tid: t.id });
    }
  }
  return { finished, written };
}
