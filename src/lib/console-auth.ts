import "server-only";
import { adminClient } from "./admin";
import { consoleCheckFresh, getAccount, isOwner, isOwnerEmail, ownerEmail } from "./auth";
import type { Actor } from "./activity";

/**
 * Who may open the console: the owner (OWNER_EMAIL), and support staff the owner has added. Both sign in with their
 * email and pass the second check (Face ID or an emailed code) on the device, every 12 hours. Staff are checked
 * against the list on every request, so someone removed is out on their next click.
 */
export type ConsoleRole = "owner" | "support";
export interface ConsoleUser extends Actor {
  role: ConsoleRole;
}

export async function isStaffEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const { data } = await adminClient().from("staff").select("email").eq("email", email.trim().toLowerCase()).is("removed_at", null).maybeSingle();
  return !!data;
}

/** May this email open the console at all (before the second check)? */
export async function consoleEmail(email: string | null | undefined): Promise<ConsoleRole | null> {
  if (isOwnerEmail(email)) return "owner";
  return (await isStaffEmail(email)) ? "support" : null;
}

export async function consoleUser(): Promise<ConsoleUser | null> {
  if (await isOwner()) {
    const a = await getAccount();
    return { email: a?.email?.toLowerCase() ?? (ownerEmail() || "owner"), role: "owner" };
  }
  const a = await getAccount();
  if (!a || !(await consoleCheckFresh())) return null;
  return (await isStaffEmail(a.email)) ? { email: a.email.toLowerCase(), role: "support" } : null;
}

export class ConsoleDenied extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** The console user, or a refusal (401 not signed in, 403 support asking for an owner-only thing). */
export async function requireConsole(need: ConsoleRole = "support"): Promise<ConsoleUser> {
  const u = await consoleUser();
  if (!u) throw new ConsoleDenied("Sign in to the console first", 401);
  if (need === "owner" && u.role !== "owner") throw new ConsoleDenied("Only the owner can do that", 403);
  return u;
}
