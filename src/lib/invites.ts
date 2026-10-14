import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "./admin";
import { newToken } from "./accounts";

/**
 * While the site is invitation-only: people ask to run a tournament, the site owner approves, and the approval
 * email carries a link that opens the setup wizard. The link works for one tournament.
 */
export interface InviteRequest {
  id: string;
  name: string;
  email: string;
  about: string | null;
  status: "new" | "approved" | "declined";
  approved_at: string | null;
  used_at: string | null;
  tournament_id: string | null;
  created_at: string;
}

export const inviteHash = (token: string) => createHash("sha256").update(`mgb-invite:${token}`).digest("hex");

export async function listInvites(): Promise<InviteRequest[]> {
  const { data, error } = await adminClient()
    .from("invite_requests")
    .select("id,name,email,about,status,approved_at,used_at,tournament_id,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  return error ? [] : ((data ?? []) as InviteRequest[]);
}

/** Approve a request: a fresh link (any earlier one stops working). Returns the token for the email. */
export async function approveInvite(id: string): Promise<{ token: string; invite: InviteRequest } | null> {
  const token = newToken();
  const { data, error } = await adminClient()
    .from("invite_requests")
    .update({ status: "approved", token_hash: inviteHash(token), approved_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .select("id,name,email,about,status,approved_at,used_at,tournament_id,created_at")
    .maybeSingle();
  if (error || !data) return null;
  return { token, invite: data as InviteRequest };
}

/** An approved, unused invite for this link, if there is one. */
export async function inviteFor(token: string): Promise<InviteRequest | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const { data } = await adminClient()
    .from("invite_requests")
    .select("id,name,email,about,status,approved_at,used_at,tournament_id,created_at")
    .eq("token_hash", inviteHash(token))
    .eq("status", "approved")
    .is("used_at", null)
    .maybeSingle();
  return (data as InviteRequest) ?? null;
}

/** The invite's tournament is made: the link is used up. */
export async function spendInvite(id: string, tournamentId: string) {
  await adminClient().from("invite_requests").update({ used_at: new Date().toISOString(), tournament_id: tournamentId }).eq("id", id);
}

export const ownerEmail = () => (process.env.OWNER_EMAIL || process.env.SMTP_USER || "").trim();
