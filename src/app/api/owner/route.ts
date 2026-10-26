import { adminClient } from "@/lib/admin";
import { consoleUser } from "@/lib/console-auth";
import { logActivity } from "@/lib/activity";
import { settle } from "@/lib/queue";
import { checkOwnerPin, getAccount, isOwner, isOwnerEmail, ownerClaimed, setOwner, setSession } from "@/lib/auth";
import { SignInError, organiserSession } from "@/lib/accounts";
import { FOLDERS, PRIVATE_BUCKET } from "@/lib/files";
import { checkOwnerCode, checkOwnerLink, passkeyAnswer, passkeyCount, passkeyQuestion, passkeySave, passkeySetup, sendOwnerCode } from "@/lib/owner-check";
import { bad, json, crossSite, CROSS_SITE } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";
import { mediaUrl } from "@/lib/supabase";
import { brandPack, demoSlug, filmLimits, filmSpend, musicTracks, sampleFilm, setSetting } from "@/lib/site";
import { defaultVoices, speak } from "@/lib/director";
import { SAMPLE_LINES } from "@/lib/sampleLines";
import { approveInvite, listInvites, ownerEmail } from "@/lib/invites";
import { inviteApprovedEmail, mailConfigured, mailSetup, sendOne, testEmail } from "@/lib/email";
import { siteOrigin } from "@/lib/server-data";
import { BRAND } from "@/lib/brand";
import { BRAND_SLOTS, MAX_TRACKS, type BrandPack, type BrandSlot, type MusicTrack, type Shape } from "@/lib/film";

export const maxDuration = 60;

/** Every table that belongs to a tournament (all deleted with it). */
const TABLES = [
  "players",
  "rounds",
  "posts",
  "shots",
  "comments",
  "fans",
  "likes",
  "reports",
  "ai_pieces",
  "votes",
  "score_changes",
  "reels",
  "subscribers",
] as const;
/** Kept by round rather than by tournament. */
const ROUND_TABLES = ["hole_entries", "attestations", "cards", "card_signatures"] as const;

/** The console's Settings: the owner's site-wide tools (films, music, email, the course library, invites). */
export async function GET() {
  if (!(await isOwner())) {
    // Not in yet: who's signed in, and what's needed (the owner's email, then the second check)
    const a = await getAccount();
    const mine = !!a && isOwnerEmail(a.email);
    return json({ owner: false, email: a?.email ?? null, ownerAccount: mine, passkeys: mine ? await passkeyCount(a!.id) : 0, pin: !(await ownerClaimed()) && !!process.env.ORGANISER_PIN });
  }
  const db = adminClient();
  const [brand, music, limits, spend, invites, demo, sample] = await Promise.all([brandPack(), musicTracks(), filmLimits(), filmSpend(), listInvites(), demoSlug(), sampleFilm()]);
  // The course library: what research found for each course, and how it went (for checking it's working)
  const { data: lib } = await db.from("course_library").select("ref,name,status,written_by,guide,work,updated_at").order("updated_at", { ascending: false }).limit(60);
  const library = (lib ?? []).map((c) => {
    const g = (c.guide ?? {}) as { holes?: Record<string, string>; overview?: string; history?: string };
    const w = (c.work ?? {}) as { log?: string[]; card?: unknown[] };
    return { ref: c.ref, name: c.name, status: c.status, by: c.written_by, holes: Object.keys(g.holes ?? {}).length, of: w.card?.length ?? null, overview: !!g.overview, history: !!g.history, at: c.updated_at, log: (w.log ?? []).slice(-14) };
  });
  return json({
    owner: true,
    invites,
    demo,
    library,
    mail: { ...mailSetup(), ownerEmail: ownerEmail() || null },
    films: {
      brand: Object.fromEntries(
        Object.entries(brand).map(([slot, shapes]) => [slot, Object.fromEntries(Object.entries(shapes ?? {}).map(([shape, c]) => [shape, c ? { ...c, src: mediaUrl(c.path) } : null]))]),
      ),
      music: music.map((m) => ({ ...m, src: mediaUrl(m.path) })),
      sample: sample ? { at: sample.at, lines: sample.lines.map((l) => ({ text: l.text, sec: l.sec, src: mediaUrl(l.path) })) } : null,
      voice: !!process.env.ELEVENLABS_API_KEY,
      limits,
      spend,
    },
    // The example tournament on the front page, by name
    demoName: demo ? ((await db.from("tournaments").select("name").eq("slug", demo).maybeSingle()).data?.name ?? demo) : null,
  });
}

/**
 *   signin  {pin}            the site owner's PIN
 *   open    {id}             run any tournament as its organiser
 *   export  {id}             everything in a tournament, as one file to keep
 *   delete  {id, name}       the tournament and everything in it, files too (the name typed to confirm)
 *   approveInvite / declineInvite {inviteId}   a request to run a tournament
 *   setDemo {slug | null}    the example tournament on the front page
 */
export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  if (b.action === "signin") {
    // The old owner PIN, only until the owner has signed in with their email
    if (tooFast(`owner:${clientIp(req)}`, 8, 600e3)) return bad("Too many tries. Wait a few minutes.", 429);
    if (!(await checkOwnerPin(String(b.pin ?? "")))) return bad("That isn't the site owner PIN", 401);
    await setOwner();
    return json({ ok: true });
  }
  // The second check: Face ID on this device, or a code (and button) by email
  const check: Record<string, () => Promise<unknown>> = {
    sendCode: () => sendOwnerCode(req),
    code: () => checkOwnerCode(String(b.code ?? "")),
    link: () => checkOwnerLink(String(b.token ?? "")),
    faceQuestion: () => passkeyQuestion(req),
    faceAnswer: () => passkeyAnswer(req, b.response),
  };
  if (b.action in check) {
    if (tooFast(`ownercheck:${clientIp(req)}`, 30, 3600e3)) return bad("Too many tries. Wait a while.", 429);
    try {
      const out = await check[b.action]();
      if (b.action === "code" || b.action === "link" || b.action === "faceAnswer") {
        const me = await consoleUser();
        if (me) await logActivity(me, "console.signin", { detail: { by: b.action === "faceAnswer" ? "Face ID" : "emailed code" } });
      }
      return json({ ok: true, options: out ?? null });
    } catch (e) {
      if (e instanceof SignInError) return bad(e.message, e.status);
      throw e;
    }
  }
  // Face ID for next time, on this device (the owner, or support staff)
  if (b.action === "faceSetup" || b.action === "faceSave") {
    if (!(await consoleUser())) return bad("Sign in to the console first", 401);
    try {
      if (b.action === "faceSetup") return json({ options: await passkeySetup(req) });
      await passkeySave(req, b.response);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof SignInError) return bad(e.message, e.status);
      throw e;
    }
  }

  if (!(await isOwner())) return bad("Site owner only", 401);
  const me = (await consoleUser()) ?? { email: "owner", role: "owner" as const };
  const did = (action: string, on: Parameters<typeof logActivity>[2] = {}) => logActivity(me, action, on);

  // ---- films: the brand pack, the music, the spending limits
  const removeFile = async (path?: string) => {
    if (path) await db.storage.from("media").remove([path]).catch(() => null);
  };
  if (b.action === "setBrand") {
    const slot = BRAND_SLOTS.find((x) => x.id === b.slot)?.id as BrandSlot | undefined;
    const shape = b.shape === "portrait" || b.shape === "landscape" ? (b.shape as Shape) : null;
    if (!slot || !shape) return bad("Which clip?");
    const path = b.path ? String(b.path) : null;
    if (path && !/^video\/site\/[\w-]+\.(mp4|mov|webm)$/.test(path)) return bad("Bad video");
    const sec = Math.max(0.3, Math.min(30, Number(b.sec) || 0));
    if (path && !(Number(b.sec) > 0)) return bad("That video's length couldn't be read. Try an MP4.");
    const brand: BrandPack = await brandPack();
    await removeFile(brand[slot]?.[shape]?.path);
    brand[slot] = { ...(brand[slot] ?? {}), [shape]: path ? { path, sec } : undefined };
    try {
      await setSetting("brand", JSON.parse(JSON.stringify(brand)));
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    await did("settings.brand");
    return json({ ok: true });
  }
  if (b.action === "addTrack") {
    const path = String(b.path ?? "");
    if (!/^audio\/site\/[\w-]+\.(mp3|m4a|wav|aac|mpeg)$/.test(path)) return bad("Bad music file");
    const music = await musicTracks();
    if (music.length >= MAX_TRACKS) return bad(`Up to ${MAX_TRACKS} tracks. Remove one first.`);
    const name = String(b.name ?? "").trim().slice(0, 40);
    if (!name) return bad("Give the track a name");
    const track: MusicTrack = { id: crypto.randomUUID().slice(0, 8), name, mood: String(b.mood ?? "").trim().slice(0, 60), path, sec: Math.max(5, Math.min(1200, Number(b.sec) || 0)) };
    if (!(Number(b.sec) > 0)) return bad("That track's length couldn't be read. Try an MP3.");
    try {
      await setSetting("music", [...music, track]);
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    await did("settings.music");
    return json({ ok: true });
  }
  if (b.action === "removeTrack") {
    const music = await musicTracks();
    const gone = music.find((m) => m.id === b.trackId);
    await removeFile(gone?.path);
    await setSetting("music", music.filter((m) => m.id !== b.trackId));
    await did("settings.music");
    return json({ ok: true });
  }
  // ---- the front page's sample round: record its commentary in the film's two voices
  if (b.action === "makeSampleFilm") {
    if (!process.env.ELEVENLABS_API_KEY) return bad("The film's voices aren't set up: ELEVENLABS_API_KEY is missing in Vercel.");
    const voices = defaultVoices();
    const stamp = Date.now().toString(36);
    let lines: { path: string; sec: number; text: string }[];
    try {
      lines = [];
      // One at a time, so the voice service isn't asked for four at once
      for (const [i, l] of SAMPLE_LINES.entries()) {
        const path = `audio/site/sample-${stamp}-${i + 1}.mp3`;
        const r = await speak("site", l.text, voices[l.voice], path);
        lines.push({ path, sec: r.sec, text: l.text });
      }
    } catch (e) {
      return bad(e instanceof Error ? e.message : "The voices didn't record", 502);
    }
    // The last recordings stay a while (pages already open may still be playing them); the ones before go
    const old = await sampleFilm();
    try {
      await setSetting("sample", { lines, at: new Date().toISOString(), previous: (old?.lines ?? []).map((l) => l.path) });
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    for (const path of old?.previous ?? []) await removeFile(path);
    return json({ ok: true });
  }
  // ---- email: send a test and report exactly what happened
  if (b.action === "testEmail") {
    const to = String(b.to ?? "").trim() || ownerEmail();
    if (!to) return bad("No address to send to. Set OWNER_EMAIL in Vercel, or type an address.");
    if (!mailConfigured()) return bad("Email isn't set up: SMTP_USER and SMTP_PASS are missing in Vercel.");
    try {
      await sendOne({ name: BRAND.name }, to, testEmail(siteOrigin(req)));
      return json({ ok: true, to });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return bad(`Sending failed: ${msg.replace(/re_[A-Za-z0-9_]+/g, "re_…").slice(0, 400)}`, 502);
    }
  }
  if (b.action === "setLimits") {
    const monthly = Math.round(Number(b.monthlyDollars) * 100);
    const per = Math.round(Number(b.perTournament));
    if (!(monthly >= 0 && monthly <= 100000) || !(per >= 0 && per <= 50)) return bad("Check the numbers");
    try {
      await setSetting("films", { monthlyCents: monthly, perTournament: per });
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    await did("settings.films", { detail: { monthly, per } });
    return json({ ok: true });
  }

  // ---- invitation-only: requests to run a tournament
  if (b.action === "approveInvite") {
    if (!mailConfigured()) return bad("Email isn't set up, so the invite can't be sent", 500);
    const done = await approveInvite(String(b.inviteId ?? ""));
    if (!done) return bad("That request has been used already, or is gone", 404);
    const link = `${siteOrigin(req)}/new?invite=${done.token}`;
    try {
      await sendOne({ name: BRAND.name }, done.invite.email, inviteApprovedEmail(done.invite.name, link));
    } catch {
      return bad("Approved, but the email didn't send. Try Approve again.", 502);
    }
    await did("invite.approve", { person: done.invite.email });
    await settle("invite", String(b.inviteId ?? ""), me.email, "Approved");
    return json({ ok: true });
  }
  if (b.action === "declineInvite") {
    await db.from("invite_requests").update({ status: "declined", token_hash: null }).eq("id", String(b.inviteId ?? "")).is("used_at", null);
    await did("invite.decline");
    await settle("invite", String(b.inviteId ?? ""), me.email, "Declined");
    return json({ ok: true });
  }
  // ---- the example tournament on the front page (null: none, the tile says "coming soon")
  if (b.action === "setDemo") {
    const slug = b.slug ? String(b.slug) : null;
    if (slug) {
      const { data: ok } = await db.from("tournaments").select("id").eq("slug", slug).maybeSingle();
      if (!ok) return bad("Tournament not found", 404);
    }
    try {
      await setSetting("demo", { slug });
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    await did("settings.demo", { detail: { slug } });
    return json({ ok: true });
  }

  const { data: t } = await db.from("tournaments").select("*").eq("id", String(b.id ?? "")).maybeSingle();
  if (!t) return bad("Tournament not found", 404);

  if (b.action === "open") {
    await setSession(t.id, await organiserSession(t.id, "owner"));
    await did("tournament.open", { tournamentId: t.id, tournamentName: t.name });
    return json({ slug: t.slug });
  }

  if (b.action === "export") {
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), tournament: { ...t, organiser_pin_hash: undefined, contributor_pin_hash: undefined } };
    for (const table of TABLES) {
      const { data } = await db.from(table).select("*").eq("tournament_id", t.id);
      out[table] = (data ?? []).map((r: Record<string, unknown>) => (table === "players" ? { ...r, pin_hash: undefined, link_code: undefined } : r));
    }
    const roundIds = ((out.rounds as { id: string }[]) ?? []).map((r) => r.id);
    for (const table of ROUND_TABLES) {
      const { data } = roundIds.length ? await db.from(table).select("*").in("round_id", roundIds) : { data: [] };
      out[table] = data ?? [];
    }
    await did("tournament.export", { tournamentId: t.id, tournamentName: t.name });
    return json(out);
  }

  if (b.action === "delete") {
    if (String(b.name ?? "").trim().toLowerCase() !== String(t.name).trim().toLowerCase()) return bad("Type the tournament's name exactly to confirm");
    // Files first (photos, clips, films, music), then the tournament: everything else goes with it
    let files = 0;
    for (const bucket of ["media", PRIVATE_BUCKET])
      for (const folder of FOLDERS) {
        const prefix = `${folder}/${t.slug}`;
        for (let round = 0; round < 50; round++) {
          const { data: list } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
          const names = (list ?? []).filter((f) => f.name && f.id !== null).map((f) => `${prefix}/${f.name}`);
          if (!names.length) break;
          const { error } = await db.storage.from(bucket).remove(names);
          if (error) break;
          files += names.length;
        }
      }
    const { error } = await db.from("tournaments").delete().eq("id", t.id);
    if (error) return bad(error.message, 500);
    await did("tournament.delete", { tournamentId: t.id, tournamentName: t.name, detail: { files } });
    return json({ ok: true, files });
  }
  return bad("Unknown action");
}
