import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "./admin";
import { currentTournament } from "./usage";

/**
 * Errors, grouped by what went wrong: the same fault, wherever and however often it happens, is one line in the
 * console's Health page with a count. Numbers, ids and addresses in the message are blanked so they group.
 */
export async function recordError(place: string, err: unknown, opts: { tid?: string | null; detail?: string } = {}) {
  try {
    const raw = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
    const message = (raw || "Unknown error").slice(0, 1000);
    const shape = message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
      .replace(/\S+@\S+/g, "@")
      .replace(/\d+/g, "#");
    const key = createHash("sha1").update(`${place}|${shape}`).digest("hex").slice(0, 24);
    const tid = opts.tid === undefined ? currentTournament() : opts.tid;
    const stack = err instanceof Error ? err.stack?.split("\n").slice(1, 7).join("\n") : undefined;
    await adminClient().rpc("record_incident", { k: key, p: place, m: shape, tid, d: opts.detail ?? stack ?? shape });
  } catch {
    // the record of an error must never cause another
  }
}
