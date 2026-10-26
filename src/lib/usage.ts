import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { adminClient } from "./admin";

/**
 * What the site spends: every paid call to an outside service is written down with its tournament and an estimate of
 * its cost (US cents, as the suppliers bill), and each service's light (working, failing) follows from its calls.
 * The tournament comes from the request: context() names it, and every call made while answering that request
 * belongs to it.
 */

export type Service = "writing" | "voices" | "films" | "video" | "courses" | "email";
export const SERVICES: { id: Service; name: string; paid: boolean }[] = [
  { id: "writing", name: "Writing (Claude)", paid: true },
  { id: "voices", name: "Voices (ElevenLabs)", paid: true },
  { id: "films", name: "Films and clips (Shotstack)", paid: true },
  { id: "video", name: "Video reading (Gemini)", paid: true },
  { id: "courses", name: "Course data (GolfAPI)", paid: true },
  { id: "email", name: "Email", paid: false },
];

/** Prices, in US cents (estimates: the real bills are typed in each month on the Money page). */
export const PRICES = {
  /** Claude Sonnet 5.5, per million tokens */
  writingInPerM: 200,
  writingOutPerM: 1000,
  /** Web search, per search */
  searchEach: 1,
  /** ElevenLabs, per 1,000 characters spoken (or a minute of speech heard) */
  voicePer1k: 30,
  listenPerMinute: 40,
  /** Shotstack, per minute of finished video */
  renderPerMinute: 20,
  /** GolfAPI: part of the subscription, nothing per call */
  courseCall: 0,
};

const scope = new AsyncLocalStorage<{ tid?: string | null }>();

/** Everything paid for from here on, in this request, belongs to this tournament. */
export function inTournament(tid: string | null | undefined) {
  scope.enterWith({ tid: tid ?? null });
}

export function currentTournament(): string | null {
  return scope.getStore()?.tid ?? null;
}

/** Run something (a film step, a background job) as this tournament's. */
export function forTournament<T>(tid: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return scope.run({ tid: tid ?? null }, fn);
}

export interface UsageEntry {
  service: Service;
  what: string;
  ok: boolean;
  cents?: number;
  units?: Record<string, number>;
  error?: string;
  tid?: string | null;
}

/** Write down one call. Never throws: the record must never break the thing being recorded. */
export async function recordUsage(u: UsageEntry): Promise<void> {
  try {
    const db = adminClient();
    const tid = u.tid === undefined ? currentTournament() : u.tid;
    const cents = Math.max(0, Math.round((u.cents ?? 0) * 1000) / 1000);
    await db.from("usage").insert({ service: u.service, what: u.what.slice(0, 60), tournament_id: tid, ok: u.ok, units: u.units ?? null, cents });
    await serviceSaw(u.service, u.ok, u.error);
    if (cents > 0) {
      spentCache.delete(u.service);
      if (u.service !== "email") await budgetCheck(u.service);
    }
  } catch (e) {
    console.warn("[usage] not recorded", e instanceof Error ? e.message : e);
  }
}

/** A service's light: the time of its last good call, and since when every call has failed. */
async function serviceSaw(service: Service, ok: boolean, error?: string) {
  const db = adminClient();
  const now = new Date().toISOString();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
  const { data: row } = await db.from("services").select("*").eq("service", service).maybeSingle();
  if (ok) {
    if (!row) await db.from("services").insert({ service, last_ok_at: now });
    else await db.from("services").update({ last_ok_at: now, failing_since: null }).eq("service", service);
    return;
  }
  const fails = row?.fails_day === today ? Number(row.fails ?? 0) + 1 : 1;
  const patch = { last_fail_at: now, failing_since: row?.failing_since ?? now, last_error: (error ?? "").slice(0, 500) || null, fails_day: today, fails };
  if (!row) await db.from("services").insert({ service, ...patch });
  else await db.from("services").update(patch).eq("service", service);
  // Failing for 15 minutes with nothing working in between: red, and the console's address hears once
  const since = Date.parse(patch.failing_since);
  if (Date.now() - since >= 15 * 60e3 && (!row?.alerted_at || Date.parse(row.alerted_at) < since)) {
    await db.from("services").update({ alerted_at: now }).eq("service", service);
    const { alert } = await import("./console-mail");
    const name = SERVICES.find((s) => s.id === service)?.name ?? service;
    await alert(`${name} is down`, [`Every call to ${name} has failed since ${new Date(since).toLocaleTimeString("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" })}.`, error ? `The last error: ${error.slice(0, 300)}` : ""].filter(Boolean));
  }
}

// ------------------------------------------------------------ budgets

export type Budgets = Record<Exclude<Service, "email">, number>;

/** A limit was reached: not a fault, so it's never counted as an error. */
export class SpendStopped extends Error {
  name = "SpendStopped";
}
export const DEFAULT_BUDGETS: Budgets = { writing: 5000, voices: 3000, films: 5000, video: 1000, courses: 0 };

const spentCache = new Map<string, { at: number; cents: number }>();

export function monthStartIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Forget the remembered spend (a budget has just changed). */
export function forgetSpent() {
  spentCache.clear();
}

/** This month's spend on a service (remembered for a minute). */
export async function spentThisMonth(service: Service): Promise<number> {
  const c = spentCache.get(service);
  if (c && Date.now() - c.at < 60e3) return c.cents;
  const { data } = await adminClient().rpc("usage_sum", { svc: service, since: monthStartIso(), tid: null });
  const cents = Number(data ?? 0);
  spentCache.set(service, { at: Date.now(), cents });
  return cents;
}

export async function budgets(): Promise<Budgets> {
  const { data } = await adminClient().from("site_settings").select("value").eq("key", "budgets").maybeSingle();
  return { ...DEFAULT_BUDGETS, ...((data?.value as Partial<Budgets>) ?? {}) };
}

/**
 * May the site spend on this service now? Not when the month's budget is used up (a budget of 0 means no limit), nor,
 * for writing, when the tournament has used its own monthly allowance. Live scoring, the feed and the leaderboard
 * never ask.
 */
export async function canSpend(service: Exclude<Service, "email">, tid?: string | null): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const b = (await budgets())[service];
    if (b > 0 && (await spentThisMonth(service)) >= b) return { ok: false, why: "The site's monthly budget for this is used up. It's paused for now." };
    const t = tid === undefined ? currentTournament() : tid;
    if (service === "writing" && t) {
      const db = adminClient();
      const [{ data: tr }, { data: sum }] = await Promise.all([
        db.from("tournaments").select("ai_cap_cents").eq("id", t).maybeSingle(),
        db.rpc("usage_sum", { svc: "writing", since: monthStartIso(), tid: t }),
      ]);
      const cap = Number(tr?.ai_cap_cents ?? 0);
      if (cap > 0 && Number(sum ?? 0) >= cap) return { ok: false, why: "This tournament's writing allowance for the month is used up. It's paused for now." };
    }
  } catch {
    // The record can't be read: carry on rather than stop the site
  }
  return { ok: true };
}

/** Crossing 80% of a month's budget goes in Needs you; reaching it also emails the console's address, once a month. */
async function budgetCheck(service: Exclude<Service, "email">) {
  const b = (await budgets())[service];
  if (!(b > 0)) return;
  const spent = await spentThisMonth(service);
  if (spent < b * 0.8) return;
  const month = monthStartIso().slice(0, 7);
  const name = SERVICES.find((s) => s.id === service)?.name ?? service;
  const { raise } = await import("./queue");
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  if (spent >= b) {
    const fresh = await raise({ kind: "spend", subject: `stop:${service}:${month}`, title: `${name}: this month's budget is used up`, detail: { service, spent, budget: b } }, { once: true });
    if (fresh) {
      const { alert } = await import("./console-mail");
      await alert(`${name} has reached its budget`, [`${name} has spent ${dollars(spent)} this month, its whole budget of ${dollars(b)}.`, "It's paused until you raise the budget or the month ends. Live scoring, the feed and the leaderboard carry on as normal."], "/console/money");
    }
  } else await raise({ kind: "spend", subject: `site:${service}:${month}`, title: `${name} is at ${Math.floor((spent / b) * 100)}% of this month's budget`, detail: { service, spent, budget: b } }, { once: true });
}

// ------------------------------------------------------------ the services themselves

/** Claude, with every call costed. `what` names the job (a report, a course's research…). */
export function claude(what: string) {
  const base = globalThis.fetch;
  const metered: typeof fetch = async (input, init) => {
    let res: Response;
    try {
      res = await base(input, init);
    } catch (e) {
      await recordUsage({ service: "writing", what, ok: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    if (String(input).includes("/v1/messages")) {
      const ok = res.ok;
      let units: Record<string, number> | undefined;
      let cents = 0;
      if (ok && (res.headers.get("content-type") ?? "").includes("json")) {
        const j = await res
          .clone()
          .json()
          .catch(() => null);
        const u = j?.usage ?? {};
        const inTok = Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0) * 0.1;
        const outTok = Number(u.output_tokens ?? 0);
        const searches = Number(u.server_tool_use?.web_search_requests ?? 0);
        units = { in: Math.round(inTok), out: outTok, ...(searches ? { searches } : {}) };
        cents = (inTok / 1e6) * PRICES.writingInPerM + (outTok / 1e6) * PRICES.writingOutPerM + searches * PRICES.searchEach;
      }
      await recordUsage({ service: "writing", what, ok, cents, units, error: ok ? undefined : `HTTP ${res.status}` });
    }
    return res;
  };
  return new Anthropic({ baseURL: process.env.ANTHROPIC_BASE_URL || undefined, fetch: metered });
}

/**
 * A call to a paid service over plain fetch (voices, films, course data): recorded whatever happens. `cents` is the
 * estimate when it works (nothing is charged for a failed call).
 */
export async function paidFetch(service: Service, what: string, url: string, init: RequestInit | undefined, est: { cents?: number; units?: Record<string, number> } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    await recordUsage({ service, what, ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  await recordUsage({ service, what, ok: res.ok, cents: res.ok ? est.cents : 0, units: est.units, error: res.ok ? undefined : `HTTP ${res.status}` });
  return res;
}
