import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { ConsoleDenied, requireConsole, type ConsoleUser } from "@/lib/console-auth";
import { logActivity } from "@/lib/activity";
import { bad } from "@/lib/server-data";
import { PRIVATE_BUCKET } from "@/lib/files";
import { brandEmail, sendOne } from "@/lib/email";
import { BRAND } from "@/lib/brand";

export const maxDuration = 60;

/**
 * Exports, as a spreadsheet file (CSV): exactly the list on screen, with its search and filters. Anything with
 * personal data is the owner's only, and every export goes in the activity record. Over 10,000 rows, it's made in the
 * background and a link (working for 24 hours) is emailed instead.
 */
const BIG = 10_000;
type Q = ReturnType<ReturnType<typeof adminClient>["from"]>;

interface Spec {
  owner: boolean;
  table: string;
  columns: [string, string][];
  build: (q: ReturnType<Q["select"]>, p: URLSearchParams) => ReturnType<Q["select"]>;
  order: string;
}

const term = (p: URLSearchParams) => (p.get("q") ?? "").trim().replace(/[%,()]/g, " ").slice(0, 80);

const SPECS: Record<string, Spec> = {
  marketing: {
    owner: true,
    table: "people",
    order: "marketing_at",
    columns: [
      ["name", "Name"],
      ["email", "Email"],
      ["marketing_at", "Ticked on"],
      ["marketing_wording", "The words they saw"],
      ["marketing_tournament", "Tournament"],
    ],
    build: (q) => q.not("marketing_at", "is", null).is("marketing_stopped_at", null),
  },
  people: {
    owner: true,
    table: "people",
    order: "first_at",
    columns: [
      ["name", "Name"],
      ["email", "Email"],
      ["roles", "Roles"],
      ["first_at", "First seen"],
      ["last_at", "Last seen"],
      ["marketing_at", "Marketing ticked on"],
      ["marketing_stopped_at", "Marketing stopped on"],
    ],
    build: (q, p) => {
      const t = term(p);
      if (t) q = q.or(`email.ilike.%${t}%,name.ilike.%${t}%`);
      const role = p.get("role");
      if (role && ["organiser", "player", "follower", "subscriber"].includes(role)) q = q.contains("roles", [role]);
      if (p.get("marketing") === "yes") q = q.not("marketing_at", "is", null).is("marketing_stopped_at", null);
      if (p.get("marketing") === "no") q = q.or("marketing_at.is.null,marketing_stopped_at.not.is.null");
      if (p.get("active") === "30") q = q.gte("last_at", new Date(Date.now() - 30 * 864e5).toISOString());
      return q;
    },
  },
  tournaments: {
    owner: false,
    table: "console_tournaments",
    order: "created_at",
    columns: [
      ["name", "Name"],
      ["slug", "Address"],
      ["organiser", "Organiser"],
      ["status", "Status"],
      ["privacy", "Who can watch"],
      ["first_day", "Starts"],
      ["last_day", "Ends"],
      ["players", "Players"],
      ["followers", "Followers"],
      ["posts", "Posts"],
      ["films", "Films"],
      ["cost_cents", "Cost so far (US cents)"],
      ["created_at", "Set up"],
    ],
    build: (q, p) => {
      const t = term(p);
      if (t) q = q.or(`name.ilike.%${t}%,slug.ilike.%${t}%,organiser.ilike.%${t}%`);
      const st = p.get("status");
      if (st && ["setting up", "coming up", "live", "finished"].includes(st)) q = q.eq("status", st);
      const pr = p.get("privacy");
      if (pr === "private" || pr === "friends") q = q.eq("privacy", pr);
      return q;
    },
  },
  costs: {
    owner: true,
    table: "usage",
    order: "at",
    columns: [
      ["at", "When"],
      ["service", "Service"],
      ["what", "What"],
      ["tournament_id", "Tournament"],
      ["ok", "Worked"],
      ["cents", "Cost (US cents)"],
    ],
    build: (q, p) => {
      const m = p.get("month") ?? new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return q;
      const [y, mo] = m.split("-").map(Number);
      return q.gte("at", `${m}-01`).lt("at", new Date(Date.UTC(y, mo, 1)).toISOString());
    },
  },
  activity: {
    owner: true,
    table: "activity",
    order: "at",
    columns: [
      ["at", "When"],
      ["actor", "Who"],
      ["actor_role", "Role"],
      ["action", "What"],
      ["tournament_name", "Tournament"],
      ["person", "Person"],
      ["detail", "Detail"],
    ],
    build: (q, p) => {
      const t = term(p);
      if (t) q = q.or(`actor.ilike.%${t}%,person.ilike.%${t}%,tournament_name.ilike.%${t}%`);
      const from = p.get("from");
      const to = p.get("to");
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte("at", from);
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lt("at", new Date(Date.parse(to) + 864e5).toISOString());
      return q;
    },
  },
};

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Spreadsheets run cells starting = + - @ as formulas: never from data people typed
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function rowsOf(spec: Spec, p: URLSearchParams, limit: number): Promise<Record<string, unknown>[]> {
  const db = adminClient();
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const q = spec.build(db.from(spec.table).select(spec.columns.map((c) => c[0]).join(",")), p);
    const { data, error } = await q.order(spec.order, { ascending: false }).range(from, Math.min(limit, from + 1000) - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

async function names(rows: Record<string, unknown>[], col: string) {
  const ids = [...new Set(rows.map((r) => r[col]).filter(Boolean))] as string[];
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await adminClient().from("tournaments").select("id,name").in("id", ids.slice(i, i + 500));
    for (const t of data ?? []) map.set(t.id, t.name);
  }
  for (const r of rows) if (r[col]) r[col] = map.get(String(r[col])) ?? "A deleted tournament";
}

async function csv(what: string, spec: Spec, p: URLSearchParams, limit: number) {
  const rows = await rowsOf(spec, p, limit);
  if (what === "marketing") await names(rows, "marketing_tournament");
  if (what === "costs") await names(rows, "tournament_id");
  const lines = [spec.columns.map((c) => cell(c[1])).join(","), ...rows.map((r) => spec.columns.map((c) => cell(r[c[0]])).join(","))];
  return { body: `﻿${lines.join("\r\n")}\r\n`, n: rows.length };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const what = u.searchParams.get("what") ?? "";
  const spec = SPECS[what];
  if (!spec) return bad("Unknown export");
  let user: ConsoleUser;
  try {
    user = await requireConsole(spec.owner ? "owner" : "support");
  } catch (e) {
    return bad(e instanceof ConsoleDenied ? e.message : "Sign in first", e instanceof ConsoleDenied ? e.status : 401);
  }
  const db = adminClient();
  const { count } = await spec.build(db.from(spec.table).select(spec.columns[0][0], { count: "exact", head: true }), u.searchParams);
  const filters = Object.fromEntries([...u.searchParams.entries()].filter(([k]) => k !== "what"));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `${what}-${stamp}.csv`;

  if ((count ?? 0) > BIG) {
    const params = new URLSearchParams(u.searchParams);
    after(async () => {
      try {
        const { body, n } = await csv(what, spec, params, 1_000_000);
        // Kept two days (the daily job clears older ones); the link works for one
        const path = `exports/${stamp}/${crypto.randomUUID()}-${file}`;
        await db.storage.from(PRIVATE_BUCKET).upload(path, body, { contentType: "text/csv; charset=utf-8", upsert: false });
        const { data } = await db.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 24 * 3600, { download: file });
        const link = data?.signedUrl?.startsWith("http") ? data.signedUrl : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${data?.signedUrl ?? ""}`;
        await sendOne({ name: `${BRAND.name} console` }, user.email, {
          subject: `Your export is ready: ${file}`,
          html: brandEmail([`Your export of ${n.toLocaleString("en-IE")} rows is ready. The link works for 24 hours.`], { label: "Download it", href: link }),
          text: `Your export of ${n} rows is ready. The link works for 24 hours:\n\n${link}\n`,
          kind: "console",
        });
        await logActivity(user, `export.${what}`, { detail: { rows: n, filters, emailed: true } });
      } catch (e) {
        console.error("[export] background export failed", e);
      }
    });
    return Response.json({ background: true, rows: count }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  const { body, n } = await csv(what, spec, u.searchParams, BIG);
  await logActivity(user, `export.${what}`, { detail: { rows: n, filters } });
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"`, "cache-control": "no-store, private" },
  });
}
