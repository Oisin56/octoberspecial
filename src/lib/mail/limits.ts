import "server-only";
import { adminClient } from "../admin";
import { allRows } from "./pages";

/**
 * The limits on marketing, so nobody is pestered: one marketing email a week at most (series and campaigns counted
 * together), none during a trip they're playing in or following, and only at 10am Irish time (the runs do that).
 */

export const dublinToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
export const dublinHour = (now = new Date()) => Number(now.toLocaleString("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hourCycle: "h23" }));

/** Everyone on a trip today: its players, followers, people signed up for its updates, and organisers */
export async function onTripToday(now = new Date()): Promise<Set<string>> {
  const db = adminClient();
  const rows = await allRows<{ email: string }>((a, b) => db.rpc("emails_on_trip", { today: dublinToday(now) }).range(a, b));
  return new Set(rows.map((r) => r.email));
}

/** Who had a marketing email in the last week */
export async function hadMarketingThisWeek(now = new Date()): Promise<Set<string>> {
  const since = new Date(now.getTime() - 7 * 864e5).toISOString();
  const db = adminClient();
  const rows = await allRows<{ email: string }>((a, b) => db.from("email_sends").select("email").eq("stream", "marketing").neq("status", "failed").gte("at", since).order("id").range(a, b));
  return new Set(rows.map((r) => r.email));
}

/** One run's gate: take(email) says yes once per person, and never to someone who's had one this week or is on a trip. */
export async function marketingGate(now = new Date()) {
  const [trip, week] = await Promise.all([onTripToday(now), hadMarketingThisWeek(now)]);
  const taken = new Set<string>();
  return {
    take(email: string) {
      const e = email.toLowerCase();
      if (trip.has(e) || week.has(e) || taken.has(e)) return false;
      taken.add(e);
      return true;
    },
    why(email: string): "trip" | "week" | null {
      const e = email.toLowerCase();
      return trip.has(e) ? "trip" : week.has(e) ? "week" : null;
    },
  };
}
