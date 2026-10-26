import "server-only";
import { adminClient } from "./admin";

/**
 * Needs you: everything waiting on a person in the console. One open item per thing (a post, a film, an invite, an
 * email address…): raising it again while it's open changes nothing. An item clears itself (`settle`) when the thing
 * is sorted elsewhere.
 */
export type QueueKind = "data_request" | "report" | "film" | "invite" | "spend" | "follow_wait" | "email_failing" | "research";

export interface QueueItem {
  kind: QueueKind;
  subject: string;
  title: string;
  tournamentId?: string | null;
  person?: string | null;
  detail?: Record<string, unknown>;
  dueAt?: string | null;
}

/** Put something in Needs you (once). True when it's new. */
export async function raise(i: QueueItem, opts: { once?: boolean } = {}): Promise<boolean> {
  // Once: never again for this thing, even after it's been cleared (a month's spending warning)
  if (opts.once) {
    const { data: seen } = await adminClient().from("queue").select("id").eq("kind", i.kind).eq("subject", i.subject).limit(1);
    if (seen?.length) return false;
  }
  const { error } = await adminClient()
    .from("queue")
    .insert({
      kind: i.kind,
      subject: i.subject,
      title: i.title.slice(0, 200),
      tournament_id: i.tournamentId ?? null,
      person: i.person ? i.person.toLowerCase() : null,
      detail: i.detail ?? null,
      due_at: i.dueAt ?? null,
    });
  // 23505: already open
  if (error && error.code !== "23505") console.warn("[queue] not raised", error.message);
  return !error;
}

/** The thing is sorted (by someone, or by itself). */
export async function settle(kind: QueueKind, subject: string, by = "system", resolution = "Sorted") {
  await adminClient()
    .from("queue")
    .update({ resolved_at: new Date().toISOString(), resolved_by: by, resolution })
    .eq("kind", kind)
    .eq("subject", subject)
    .is("resolved_at", null);
}

export const KIND_WORDS: Record<QueueKind, string> = {
  data_request: "Data request",
  report: "Reported post or comment",
  film: "Film failed or stuck",
  invite: "Invite request",
  spend: "Spending",
  follow_wait: "Follow requests waiting",
  email_failing: "Email not getting through",
  research: "Course research failed",
};
