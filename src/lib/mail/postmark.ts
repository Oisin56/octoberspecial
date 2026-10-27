import "server-only";
import { getSetting, setSetting } from "../site";
import { webhookPassword } from "./tokens";

/**
 * Postmark: the sending service. Three message streams keep the kinds of email apart, so a complaint about a newsletter
 * never touches sign-in codes. Set up from the console (or the morning jobs) once POSTMARK_TOKEN is in Vercel: the
 * streams are made, and Postmark is told where to send bounces and complaints.
 */

export type Stream = "service" | "updates" | "marketing";

export interface PostmarkSetup {
  at: string;
  server: string | null;
  streams: Record<Stream, string>;
  /** Our own one-tap unsubscribe on marketing (Postmark allows it on approved accounts); otherwise Postmark's */
  customUnsub: boolean;
  webhooks: boolean;
  problem?: string | null;
}

export const DEFAULT_STREAMS: Record<Stream, string> = { service: "outbound", updates: "updates", marketing: "broadcast" };

export const postmarkOn = () => !!process.env.POSTMARK_TOKEN;
const base = () => (process.env.POSTMARK_API_URL || "https://api.postmarkapp.com").replace(/\/$/, "");

export class PostmarkError extends Error {
  constructor(
    message: string,
    public code: number,
    public status: number,
  ) {
    super(message);
  }
}

/** One call to Postmark's API. Throws with Postmark's own words when it says no. */
export async function pm<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = process.env.POSTMARK_TOKEN;
  if (!token) throw new Error("POSTMARK_TOKEN isn't set");
  const r = await fetch(`${base()}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { accept: "application/json", "content-type": "application/json", "x-postmark-server-token": token },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || (typeof j.ErrorCode === "number" && j.ErrorCode !== 0 && !Array.isArray(j))) {
    throw new PostmarkError(String(j.Message ?? `Postmark said ${r.status}`), Number(j.ErrorCode ?? 0), r.status);
  }
  return j as T;
}

let cached: { at: number; v: PostmarkSetup | null } | null = null;
export async function postmarkSetup(): Promise<PostmarkSetup | null> {
  if (cached && Date.now() - cached.at < 60e3) return cached.v;
  const v = await getSetting<PostmarkSetup | null>("postmark", null);
  cached = { at: Date.now(), v: v && v.streams ? v : null };
  return cached.v;
}

/** The stream a kind of email goes out on (the defaults until setup has run). */
export async function streamId(s: Stream): Promise<string> {
  const v = await postmarkSetup();
  return v?.streams?.[s] ?? DEFAULT_STREAMS[s];
}

interface StreamRow {
  ID: string;
  Name: string;
  MessageStreamType: string;
  ArchivedAt?: string | null;
  SubscriptionManagementConfiguration?: { UnsubscribeHandlingType?: string };
}

/**
 * Make sure Postmark is ready: the token works, the three streams exist, and bounces, complaints and stops come back
 * to the site. Safe to run again: it only adds what's missing.
 */
export async function setUpPostmark(site: string): Promise<PostmarkSetup> {
  const server = await pm<{ Name?: string }>("/server").catch((e) => {
    throw new Error(`Postmark didn't accept the token: ${e instanceof Error ? e.message : e}`);
  });
  const list = await pm<{ MessageStreams: StreamRow[] }>("/message-streams?MessageStreamType=All&IncludeArchivedStreams=false");
  const rows = list.MessageStreams ?? [];
  const streams: Record<Stream, string> = { ...DEFAULT_STREAMS };

  // Service: the server's own transactional stream
  streams.service = rows.find((r) => r.ID === "outbound")?.ID ?? rows.find((r) => r.MessageStreamType === "Transactional")?.ID ?? "outbound";
  // Updates: a second transactional stream of its own
  if (!rows.some((r) => r.ID === "updates")) {
    await pm("/message-streams", { body: { ID: "updates", Name: "Tournament updates", Description: "Previews, reports and the evening email, to people who asked for them", MessageStreamType: "Transactional" } });
  }
  streams.updates = "updates";
  // Marketing: a broadcast stream
  let broadcast = rows.find((r) => r.MessageStreamType === "Broadcasts");
  if (!broadcast) {
    await pm("/message-streams", { body: { ID: "broadcast", Name: "News and offers", Description: "The series and campaigns, to people who ticked the box", MessageStreamType: "Broadcasts" } });
    broadcast = { ID: "broadcast", Name: "News and offers", MessageStreamType: "Broadcasts" };
  }
  streams.marketing = broadcast.ID;
  // Our own unsubscribe page and one-tap stop (Postmark allows it once they've approved the account for it)
  let customUnsub = broadcast.SubscriptionManagementConfiguration?.UnsubscribeHandlingType === "Custom";
  if (!customUnsub) {
    customUnsub = await pm(`/message-streams/${encodeURIComponent(broadcast.ID)}`, { method: "PATCH", body: { SubscriptionManagementConfiguration: { UnsubscribeHandlingType: "Custom" } } }).then(
      () => true,
      () => false,
    );
  }

  // Bounces, complaints and stops, for each stream
  const url = `${site}/api/email/postmark`;
  const want = {
    Url: url,
    HttpAuth: { Username: "postmark", Password: webhookPassword() },
    Triggers: {
      Open: { Enabled: false, PostFirstOpenOnly: false },
      Click: { Enabled: false },
      Delivery: { Enabled: false },
      Bounce: { Enabled: true, IncludeContent: false },
      SpamComplaint: { Enabled: true, IncludeContent: false },
      SubscriptionChange: { Enabled: true },
    },
  };
  for (const id of new Set(Object.values(streams))) {
    const hooks = await pm<{ Webhooks: { ID: number; Url: string }[] }>(`/webhooks?MessageStream=${encodeURIComponent(id)}`);
    const mine = (hooks.Webhooks ?? []).find((h) => h.Url === url);
    if (mine) await pm(`/webhooks/${mine.ID}`, { method: "PUT", body: want });
    else await pm("/webhooks", { body: { ...want, MessageStream: id } });
  }

  const v: PostmarkSetup = { at: new Date().toISOString(), server: server.Name ?? null, streams, customUnsub, webhooks: true, problem: null };
  await setSetting("postmark", v);
  cached = { at: Date.now(), v };
  return v;
}

/** Let an address get email again on a stream (after a bounce the owner has checked). Spam complaints can't be lifted. */
export async function reactivate(email: string) {
  const v = await postmarkSetup();
  for (const id of new Set(Object.values(v?.streams ?? DEFAULT_STREAMS))) {
    await pm(`/message-streams/${encodeURIComponent(id)}/suppressions/delete`, { body: { Suppressions: [{ EmailAddress: email }] } }).catch(() => null);
  }
}
