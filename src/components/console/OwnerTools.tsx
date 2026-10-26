"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { useRouter } from "next/navigation";
import { BRAND_SLOTS, MAX_TRACKS, dollars, type BrandSlot, type Shape } from "@/lib/film";
import { mediaSeconds, uploadBlob } from "@/lib/upload";
import { EmailSignIn } from "@/components/EmailSignIn";

export interface Films {
  brand: Partial<Record<BrandSlot, Partial<Record<Shape, { path: string; sec: number; src: string } | null>>>>;
  music: { id: string; name: string; mood: string; sec: number; src: string }[];
  sample: { at: string; lines: { text: string; sec: number; src: string }[] } | null;
  voice: boolean;
  limits: { monthlyCents: number; perTournament: number };
  spend: { cents: number; films: number };
}

interface Row {
  id: string;
  slug: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  published: boolean;
  created_at: string;
  players: number;
  rounds: number;
  posts: number;
}

export interface Mail {
  host: string;
  port: number;
  from: string | null;
  login: boolean;
  password: boolean;
  ownerEmail: string | null;
}

export interface Invite {
  id: string;
  name: string;
  email: string;
  about: string | null;
  status: "new" | "approved" | "declined";
  approved_at: string | null;
  used_at: string | null;
  created_at: string;
}

const day = (d: string) => new Date(d).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });

/** How the site sends email, and a test that shows exactly what happens. */
export function MailCheck({ mail, post }: { mail: Mail; post: Post }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send() {
    setBusy(true);
    setMsg(null);
    const r = await post({ action: "testEmail", to: to.trim() });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: `Sent to ${String(r.j.to)}. Check that inbox (and spam).` } : { ok: false, text: String(r.j.error ?? "Didn't send") });
  }
  const row = (k: string, v: string, good: boolean) => (
    <li>
      <span>{k}</span> <strong className={good ? "" : "error"}>{v}</strong>
    </li>
  );
  return (
    <section className="owner-mail" aria-label="Email">
      <h2>Email</h2>
      <ul className="owner-mail-list">
        {row("Sending through", `${mail.host}, port ${mail.port}`, true)}
        {row("From", mail.from ?? "not set (MAIL_FROM)", !!mail.from)}
        {row("Login and password", mail.login && mail.password ? "set" : "missing (SMTP_USER, SMTP_PASS)", mail.login && mail.password)}
        {row("Invite requests go to", mail.ownerEmail ?? "not set (OWNER_EMAIL)", !!mail.ownerEmail)}
      </ul>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 220px", margin: 0 }}>
          <label htmlFor="mail-to">Send a test to</label>
          <input id="mail-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={mail.ownerEmail ?? "an email address"} />
        </div>
        <button className="btn" disabled={busy} onClick={send}>
          {busy ? "Sending…" : "Send a test email"}
        </button>
      </div>
      {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}
    </section>
  );
}

/** Requests to run a tournament while it's invitation-only: approve (emails them a link) or decline. */
export type LibraryRow = { ref: string; name: string; status: string; by: string; holes: number; of: number | null; overview: boolean; history: boolean; at: string; log: string[] };

/** The course library: what the background research found for each course, and how it went. */
export function Library({ rows }: { rows: LibraryRow[] }) {
  if (!rows.length) return null;
  const line = (c: LibraryRow) =>
    c.status === "researching"
      ? "reading up on it now"
      : c.status === "none"
        ? "nothing found"
        : [c.holes ? `${c.holes}${c.of ? ` of ${c.of}` : ""} holes` : null, c.overview ? "about the course" : null, c.history ? "history" : null, c.by === "organiser" ? "written by the organiser" : null].filter(Boolean).join(", ");
  return (
    <details className="owner-earlier">
      <summary>Course library: {rows.length} courses</summary>
      <ul>
        {rows.map((c) => (
          <li key={c.ref}>
            <details>
              <summary>
                <strong>{c.name || c.ref}</strong>: {line(c)}
              </summary>
              {c.log.length > 0 && (
                <ul className="small">
                  {c.log.map((l, i) => (
                    <li key={i} style={{ overflowWrap: "anywhere" }}>
                      {l}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Invites({ invites, post, reload }: { invites: Invite[]; post: Post; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const waiting = invites.filter((i) => i.status === "new");
  const rest = invites.filter((i) => i.status !== "new").slice(0, 20);
  async function act(i: Invite, action: "approveInvite" | "declineInvite") {
    setBusy(i.id);
    setMsg(null);
    const r = await post({ action, inviteId: i.id });
    setBusy(null);
    setMsg(r.ok ? (action === "approveInvite" ? `Invite emailed to ${i.email}` : "Declined") : String(r.j.error ?? "Didn't work"));
    reload();
  }
  return (
    <section className="owner-invites" aria-label="Invite requests">
      <h2>Invite requests {waiting.length ? <span className="owner-count">{waiting.length} waiting</span> : null}</h2>
      {msg && <p className="notice">{msg}</p>}
      {!invites.length && <p className="small">None yet. People ask from the front page.</p>}
      {waiting.map((i) => (
        <article className="owner-t" key={i.id}>
          <div className="owner-h">
            <strong>{i.name}</strong>
            <span className="owner-meta">{i.email}</span>
          </div>
          {i.about && <p className="owner-about">{i.about}</p>}
          <p className="owner-meta">Asked {day(i.created_at)}</p>
          <div className="owner-acts">
            <button className="btn" disabled={!!busy} onClick={() => act(i, "approveInvite")}>
              {busy === i.id ? "Sending…" : "Approve and email the link"}
            </button>
            <button className="btn secondary" disabled={!!busy} onClick={() => act(i, "declineInvite")}>
              Decline
            </button>
          </div>
        </article>
      ))}
      {rest.length > 0 && (
        <details className="owner-earlier">
          <summary>Earlier requests</summary>
          <ul>
            {rest.map((i) => (
              <li key={i.id}>
                <strong>{i.name}</strong> ({i.email}): {i.used_at ? "set up a tournament" : i.status === "approved" ? `invited ${day(i.approved_at ?? i.created_at)}` : "declined"}
                {i.status === "approved" && !i.used_at && (
                  <>
                    {" "}
                    <button className="linklike" disabled={!!busy} onClick={() => act(i, "approveInvite")}>
                      Send the link again
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export type Post = (body: Record<string, unknown>) => Promise<{ ok: boolean; j: Record<string, unknown> & { error?: string } }>;

/** Films across the site: what they cost, the brand pack every film opens and closes with, the music. */
export function FilmSettings({ films, post, reload }: { films: Films; post: Post; reload: () => void }) {
  const [monthly, setMonthly] = useState(String(films.limits.monthlyCents / 100));
  const [per, setPer] = useState(String(films.limits.perTournament));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mood, setMood] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const say = (r: { ok: boolean; j: { error?: string } }, ok: string) => {
    setMsg(r.ok ? ok : String(r.j.error ?? "That didn't work"));
    if (r.ok) reload();
  };
  async function brand(slot: BrandSlot, shape: Shape, f: File | null) {
    setBusy(`${slot}-${shape}`);
    setMsg(null);
    try {
      if (!f) return say(await post({ action: "setBrand", slot, shape, path: null }), "Removed");
      const sec = await mediaSeconds(f, "video");
      const path = await uploadBlob(f, { contentType: f.type || "video/mp4", filename: f.name });
      say(await post({ action: "setBrand", slot, shape, path, sec }), "Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }
  async function addTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy("track");
    setMsg(null);
    try {
      const sec = await mediaSeconds(file, "audio");
      const path = await uploadBlob(file, { contentType: file.type || "audio/mpeg", filename: file.name });
      const r = await post({ action: "addTrack", path, sec, name, mood });
      say(r, "Track added");
      if (r.ok) {
        setName("");
        setMood("");
        setFile(null);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }
  const used = films.limits.monthlyCents ? Math.min(100, Math.round((films.spend.cents / films.limits.monthlyCents) * 100)) : 100;

  return (
    <section className="owner-films stack">
      <h2>Films</h2>
      {msg && <p className={/saved|added|removed/i.test(msg) ? "notice" : "error"}>{msg}</p>}

      <div className="panel stack">
        <h3>Spending</h3>
        <p>
          This month: <strong>{dollars(films.spend.cents)}</strong> of {dollars(films.limits.monthlyCents)} across the whole site, {films.spend.films} film{films.spend.films === 1 ? "" : "s"}. These are estimates from the services&apos; prices.
        </p>
        <div className="owner-meter" role="img" aria-label={`${used}% of this month's film budget used`}>
          <span style={{ width: `${used}%` }} />
        </div>
        <div className="row owner-limits">
          <label className="field">
            <span>Monthly limit, all tournaments ($)</span>
            <input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </label>
          <label className="field">
            <span>Films each tournament can make</span>
            <input inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value)} />
          </label>
        </div>
        <button className="btn" disabled={!!busy} onClick={async () => say(await post({ action: "setLimits", monthlyDollars: Number(monthly), perTournament: Number(per) }), "Saved")}>
          Save the limits
        </button>
      </div>

      <div className="panel stack">
        <h3>Brand pack</h3>
        <p className="small">Short MP4 clips with their own sound. Upload both shapes: upright for films made for phones, wide for YouTube and TV.</p>
        <div className="owner-brand">
          {BRAND_SLOTS.map((slot) => (
            <div key={slot.id} className="owner-slot">
              <strong>{slot.name}</strong>
              <small>{slot.note}</small>
              {(["portrait", "landscape"] as Shape[]).map((shape) => {
                const c = films.brand[slot.id]?.[shape];
                return (
                  <div key={shape} className="owner-clip">
                    <span>{shape === "portrait" ? "Upright" : "Wide"}</span>
                    {c ? (
                      <>
                        <a href={c.src} target="_blank" rel="noreferrer">
                          Watch ({c.sec.toFixed(1)}s)
                        </a>
                        <button className="linklike" disabled={!!busy} onClick={() => brand(slot.id, shape, null)}>
                          Remove
                        </button>
                      </>
                    ) : null}
                    <label className={`btn secondary small-btn${busy === `${slot.id}-${shape}` ? " busy" : ""}`}>
                      {busy === `${slot.id}-${shape}` ? "Uploading…" : c ? "Replace" : "Upload"}
                      <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden disabled={!!busy} onChange={(e) => e.target.files?.[0] && brand(slot.id, shape, e.target.files[0])} />
                    </label>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="panel stack">
        <h3>Sample round</h3>
        <p className="small">
          The commentary on Declan&apos;s putt in the front page&apos;s sample round, in the film&apos;s two voices. Make it once (and again if you change the voices). The music under it is your first track
          {films.music[0] ? ` (${films.music[0].name})` : ": there are none yet, so it plays without music"}.
        </p>
        {films.sample ? (
          <ul className="owner-tracks">
            {films.sample.lines.map((l, i) => (
              <li key={i}>
                <div>
                  <strong>{l.text.replace(/\[[a-z ]+\]\s*/gi, "")}</strong>
                  <small>{l.sec.toFixed(1)}s</small>
                </div>
                <audio src={l.src} controls preload="none" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Not made yet. Until it is, the sample plays with the clip&apos;s own sound{films.music[0] ? " and the music" : ""}.</p>
        )}
        <button
          className="btn"
          disabled={!!busy || !films.voice}
          onClick={async () => {
            setBusy("sample");
            setMsg(null);
            say(await post({ action: "makeSampleFilm" }), "Saved: the sample commentary is made");
            setBusy(null);
          }}
        >
          {busy === "sample" ? "Recording the voices…" : films.sample ? "Make the sample commentary again" : "Make the sample commentary"}
        </button>
        {!films.voice && <p className="small muted">Needs the film&apos;s voices: ELEVENLABS_API_KEY in Vercel.</p>}
        {films.sample && <p className="small muted">Made {day(films.sample.at)}.</p>}
      </div>

      <div className="panel stack">
        <h3>Music</h3>
        <p className="small">Up to {MAX_TRACKS} tracks for organisers to choose from. Use music licensed for people to post on YouTube, Instagram and Facebook (not registered with YouTube&apos;s Content ID), at least 4 minutes long if you can.</p>
        {films.music.length ? (
          <ul className="owner-tracks">
            {films.music.map((m) => (
              <li key={m.id}>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.mood ? `${m.mood} · ` : ""}
                    {Math.floor(m.sec / 60)}:{String(Math.round(m.sec % 60)).padStart(2, "0")}
                  </small>
                </div>
                <audio src={m.src} controls preload="none" />
                <button className="linklike" disabled={!!busy} onClick={async () => say(await post({ action: "removeTrack", trackId: m.id }), "Removed")}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No tracks yet. Until there are, films are made without music.</p>
        )}
        {films.music.length < MAX_TRACKS && (
          <form className="stack" onSubmit={addTrack}>
            <div className="row owner-limits">
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday charge" />
              </label>
              <label className="field">
                <span>Mood (optional)</span>
                <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Epic, building" />
              </label>
            </div>
            <input type="file" accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button className="btn" disabled={!file || !name.trim() || !!busy}>
              {busy === "track" ? "Uploading…" : "Add the track"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ getting in

export interface Gate {
  email: string | null;
  ownerAccount: boolean;
  passkeys: number;
  pin: boolean;
}

/**
 * The site owner signs in with their email like everyone else, then a second check on this device: Face ID or
 * Touch ID, or a code sent to their email. The old owner PIN works only until that's been done once.
 */
export function OwnerGate({ gate, post, onIn }: { gate: Gate; post: (b: Record<string, unknown>) => Promise<{ ok: boolean; j: Record<string, unknown> }>; onIn: () => void }) {
  const [step, setStep] = useState<"start" | "code" | "pin" | "offerFace">("start");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [face, setFace] = useState(false);
  useEffect(() => {
    let live = true;
    import("@simplewebauthn/browser")
      .then((m) => (m.browserSupportsWebAuthn() ? m.platformAuthenticatorIsAvailable() : false))
      .then((ok) => live && setFace(!!ok))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const r = await post(body);
    setBusy(false);
    if (!r.ok) setErr(String(r.j.error ?? "That didn't work. Try again."));
    return r;
  }

  async function useFace() {
    const q = await run({ action: "faceQuestion" });
    if (!q.ok) return;
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const response = await startAuthentication({ optionsJSON: q.j.options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      const a = await run({ action: "faceAnswer", response });
      if (a.ok) onIn();
    } catch {
      setErr("Face ID was cancelled. Try again, or use the emailed code.");
    }
  }

  async function setUpFace() {
    const q = await run({ action: "faceSetup" });
    if (!q.ok) return;
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration({ optionsJSON: q.j.options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      const a = await run({ action: "faceSave", response });
      if (a.ok) onIn();
    } catch {
      setErr("Face ID wasn't set up. You can do it next time.");
    }
  }

  if (step === "offerFace")
    return (
      <section className="panel stack sign-in" style={{ maxWidth: 480 }}>
        <h2>Use Face ID next time?</h2>
        <p className="lead">On this device, Face ID or Touch ID can do the check instead of an emailed code.</p>
        {err && <p className="error">{err}</p>}
        <button className="btn block big" disabled={busy} onClick={setUpFace}>
          Set up Face ID
        </button>
        <button className="btn secondary block" onClick={onIn}>
          Not now
        </button>
      </section>
    );

  if (step === "pin")
    return (
      <form
        className="panel stack sign-in"
        style={{ maxWidth: 480 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await run({ action: "signin", pin })).ok) onIn();
        }}
      >
        <div className="field">
          <label htmlFor="opin">Site owner PIN</label>
          <input id="opin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoComplete="off" autoFocus />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn block big" disabled={busy}>
          Sign in
        </button>
        <button type="button" className="linklike" onClick={() => (setStep("start"), setErr(null))}>
          Sign in with the owner&apos;s email instead
        </button>
      </form>
    );

  if (!gate.email)
    return (
      <div style={{ maxWidth: 520 }}>
        <EmailSignIn title="Sign in" level={2} lead="The owner and support staff sign in with their email, then confirm it's them on this device." next="/console" onSignedIn={() => onIn()}>
          {gate.pin && (
            <button type="button" className="linklike" onClick={() => setStep("pin")}>
              Use the site owner PIN
            </button>
          )}
        </EmailSignIn>
      </div>
    );

  if (!gate.ownerAccount)
    return (
      <section className="panel stack" style={{ maxWidth: 480 }}>
        <p className="lead">
          You&apos;re signed in as <strong>{gate.email}</strong>, which isn&apos;t the owner&apos;s email or a member of staff&apos;s.
        </p>
        <Link className="btn secondary block" href="/account">
          Go to My golf
        </Link>
      </section>
    );

  if (step === "code")
    return (
      <form
        className="panel stack sign-in"
        style={{ maxWidth: 480 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!(await run({ action: "code", code })).ok) return;
          if (face) setStep("offerFace");
          else onIn();
        }}
      >
        <h2>Check your email</h2>
        <p className="lead">We&apos;ve sent a code to {gate.email}. Type it here, or tap the button in the email.</p>
        <div className="field">
          <label htmlFor="ow-code">The code from the email</label>
          <input id="ow-code" className="si-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn block big" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Carry on"}
        </button>
      </form>
    );

  return (
    <section className="panel stack sign-in" style={{ maxWidth: 480 }}>
      <h2>Confirm it&apos;s you</h2>
      <p className="lead">The console has everything on the site, so it asks for one more check on this device.</p>
      {err && <p className="error">{err}</p>}
      {gate.passkeys > 0 && face && (
        <button className="btn block big" disabled={busy} onClick={useFace}>
          Use Face ID
        </button>
      )}
      <button
        className={`btn block ${gate.passkeys > 0 && face ? "secondary" : "big"}`}
        disabled={busy}
        onClick={async () => {
          if ((await run({ action: "sendCode" })).ok) setStep("code");
        }}
      >
        Email me a code
      </button>
    </section>
  );
}
