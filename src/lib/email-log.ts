import "server-only";
import { adminClient } from "./admin";
import { recordUsage } from "./usage";

/** Emails, counted by kind for the console's Health page; failures written down. Never throws. */

const blocked = new Map<string, { at: number; v: boolean }>();

export async function emailBlocked(to: string): Promise<boolean> {
  const e = to.trim().toLowerCase();
  const c = blocked.get(e);
  if (c && Date.now() - c.at < 60e3) return c.v;
  const { data } = await adminClient()
    .from("email_blocks")
    .select("email")
    .eq("email", e)
    .maybeSingle()
    .then(
      (r) => r,
      () => ({ data: null }),
    );
  const v = !!data;
  blocked.set(e, { at: Date.now(), v });
  if (blocked.size > 5000) blocked.clear();
  return v;
}

export function forgetBlocked(email: string) {
  blocked.delete(email.trim().toLowerCase());
}

export async function emailSent(kind: string) {
  try {
    await adminClient().rpc("bump", { nm: `email:${kind}` });
    await recordUsage({ service: "email", what: kind, ok: true, cents: 0 });
  } catch {
    // counting must never stop an email
  }
}

/** A send that failed: counted, kept, and on the third failure to one address in a week, put in Needs you. */
export async function emailFailed(to: string, kind: string, err: unknown) {
  try {
    const db = adminClient();
    const email = to.trim().toLowerCase();
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await db.rpc("bump", { nm: "email-failed" });
    await db.from("email_failures").insert({ email, kind, error: message });
    await recordUsage({ service: "email", what: kind, ok: false, error: message });
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count } = await db.from("email_failures").select("id", { count: "exact", head: true }).eq("email", email).gte("at", since);
    if ((count ?? 0) >= 3) {
      const { raise } = await import("./queue");
      await raise({ kind: "email_failing", subject: email, person: email, title: `Emails to ${email} aren't getting through`, detail: { error: message } });
    }
  } catch {
    // never stop the caller
  }
}
