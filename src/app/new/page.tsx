"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { formatName, winName } from "@/lib/wizard";
import { fresh, named, settle, stepsFor, toWizard, type Draft } from "@/components/setup/model";
import {
  AboutScreen,
  CountScreen,
  CourseScreen,
  ExtrasScreen,
  FormatScreen,
  GroupsScreen,
  HolesScreen,
  LookScreen,
  NameScreen,
  PlayersScreen,
  PointsScreen,
  PrizesScreen,
  Problems,
  Screen,
  TeamsScreen,
  TeeScreen,
  Tile,
  Tiles,
  WhenScreen,
  WhoScreen,
  WinMoreScreen,
  WinScreen,
  type StepProps,
} from "@/components/setup/Screens";

/**
 * The set-up wizard: one question per screen, big tiles, and one "Create my tournament" at the end.
 * Answers stay on this phone as you go, so a locked screen or a phone call loses nothing.
 */

const KEY = "mgb-wizard-v2";
const INVITE_KEY = "mgb-invite";

type Me = { owner: boolean; email: string | null; invite: string | null };

export default function NewTournament() {
  const router = useRouter();
  const [d, setD] = useState<Draft>(fresh);
  const [loaded, setLoaded] = useState(false);
  const [hasOld, setHasOld] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [pastGate, setPastGate] = useState(false);

  // Pick up where you left off
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const old = JSON.parse(raw) as Draft;
          if (old?.v === 2 && old.who) {
            setD({ ...fresh(), ...old });
            setHasOld(true);
          }
        }
      } catch {
        /* private browsing: start fresh */
      }
      setLoaded(true);
    }, 0);
    // An approved invite: the link in the email (kept on the phone in case they come back to the wizard later)
    let invite: string | null = null;
    try {
      invite = new URLSearchParams(window.location.search).get("invite") || localStorage.getItem(INVITE_KEY);
      if (invite) localStorage.setItem(INVITE_KEY, invite);
    } catch {}
    const checkInvite = invite
      ? fetch("/api/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "check", token: invite }) })
          .then((r) => r.ok)
          .catch(() => false)
      : Promise.resolve(false);
    Promise.all([fetch("/api/owner").then((r) => r.json()).catch(() => ({})), fetch("/api/account").then((r) => r.json()).catch(() => ({})), checkInvite]).then(([o, a, okInvite]) => {
      if (invite && !okInvite)
        try {
          localStorage.removeItem(INVITE_KEY);
        } catch {}
      setMe({ owner: !!o.owner, email: a.account?.email ?? null, invite: okInvite ? invite : null });
    });
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* fine */
    }
  }, [d, loaded]);

  const steps = useMemo(() => stepsFor(d), [d]);
  const at = Math.max(0, steps.indexOf(d.step));
  const step = steps[at] ?? "who";
  const [kind, idxRaw] = step.split(":");
  const ri = Number(idxRaw ?? 0);
  const topRef = useRef<HTMLDivElement>(null);

  const go = (to: string) => {
    setD((x) => ({ ...x, step: to }));
    topRef.current?.scrollIntoView({ block: "start" });
  };
  const props: StepProps = {
    d,
    set: (fn) => setD((x) => settle(fn(x))),
    done: (patch) => {
      const nd = settle({ ...d, ...patch });
      const list = stepsFor(nd);
      if (!patch?.step || !list.includes(patch.step)) nd.step = list[Math.min(list.length - 1, list.indexOf(step) + 1)];
      setD(nd);
      topRef.current?.scrollIntoView({ block: "start" });
    },
  };
  const back = () => (at > 0 ? go(steps[at - 1]) : router.push("/"));
  const startAgain = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* fine */
    }
    setHasOld(false);
    setD(fresh());
  };

  if (!loaded) return <Shell>{null}</Shell>;
  if (me && !me.owner && !me.invite && !pastGate && !hasOld)
    return (
      <Shell>
        <div className="wz">
          <Screen q="It's invitation-only for now" hint="Ask for an invite and we'll email you a link to set up your tournament.">
            <Link className="btn glow block wz-next" href="/invite">
              Request an invite
            </Link>
            <button type="button" className="linklike wz-owner-skip" onClick={() => setPastGate(true)}>
              I have the site owner&apos;s PIN
            </button>
          </Screen>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div ref={topRef} className="wz" data-step={kind}>
        <div className="wz-top">
          <button type="button" className="back-home" onClick={back}>
            <span aria-hidden>←</span> {at === 0 ? "Home" : "Back"}
          </button>
          <div className="wz-progress" aria-label={`Step ${at + 1} of ${steps.length}`}>
            <span style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
          </div>
        </div>

        {kind === "who" && hasOld && (
          <p className="notice">
            Carrying on from where you left off.{" "}
            <button type="button" className="linklike" onClick={startAgain}>
              Start again
            </button>
          </p>
        )}
        {kind === "who" && <WhoScreen {...props} />}
        {kind === "name" && <NameScreen {...props} />}
        {kind === "players" && <PlayersScreen {...props} />}
        {kind === "teams" && <TeamsScreen {...props} />}
        {kind === "win" && <WinScreen {...props} />}
        {kind === "winmore" && <WinMoreScreen {...props} />}
        {kind === "count" && <CountScreen {...props} />}
        {kind === "course" && <CourseScreen key={ri} {...props} i={ri} />}
        {kind === "tee" && <TeeScreen key={ri} {...props} i={ri} />}
        {kind === "holes" && <HolesScreen {...props} i={ri} />}
        {kind === "format" && <FormatScreen {...props} i={ri} />}
        {kind === "when" && <WhenScreen key={ri} {...props} i={ri} />}
        {kind === "points" && <PointsScreen {...props} />}
        {kind === "groups" && <GroupsScreen {...props} />}
        {kind === "prizes" && <PrizesScreen {...props} />}
        {kind === "extras" && <ExtrasScreen {...props} />}
        {kind === "look" && <LookScreen {...props} />}
        {kind === "about" && <AboutScreen {...props} />}
        {kind === "safe" && <SafeStep d={d} setD={setD} me={me} onDone={(slug) => (forget(), router.push(`/t/${slug}/ready`))} onFix={go} />}
        {kind !== "safe" && kind !== "who" && kind !== "name" && <Problems d={d} />}
      </div>
    </Shell>
  );
}

function forget() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(INVITE_KEY);
  } catch {
    /* fine */
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-root" data-theme="spring">
      <header className="site-head">
        <div className="wrap" style={{ padding: "18px 16px" }}>
          <Link href="/" className="site-title">
            {BRAND.name}
          </Link>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </div>
  );
}

// ------------------------------------------------------------------ create

function SafeStep({ d, setD, me, onDone, onFix }: { d: Draft; setD: (x: Draft) => void; me: Me | null; onDone: (slug: string) => void; onFix: (step: string) => void }) {
  const [ownerPin, setOwnerPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const signedIn = me?.email;
  const needOwner = me && !me.owner && !me.invite;
  const okKeep = signedIn || (d.keep === "email" && /\S+@\S+\.\S+/.test(d.email)) || (d.keep === "pin" && /^\d{4,8}$/.test(d.pin));

  async function create() {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wizard: toWizard(d), email: !signedIn && d.keep === "email" ? d.email : "", pin: d.keep === "pin" ? d.pin : "", ownerPin, invite: me?.invite ?? undefined }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setErr(j.error ?? "Couldn't create it just now. Check the signal and try again.");
    onDone(j.slug);
  }

  return (
    <Screen q="Last thing: keeping it safe" hint="So only you can run it, and you can get back in on any phone.">
      {needOwner && (
        <div className="field">
          <label htmlFor="wz-owner">Site owner PIN</label>
          <input id="wz-owner" className="wz-input" inputMode="numeric" value={ownerPin} onChange={(e) => setOwnerPin(e.target.value)} placeholder="Needed while new tournaments are invite-only" />
        </div>
      )}
      {signedIn ? (
        <p className="notice">
          Signed in as <strong>{me?.email}</strong>. It&apos;ll be in My tournaments.
        </p>
      ) : (
        <>
          <Tiles>
            <Tile on={d.keep === "email"} title="Use my email" note="Recommended. It goes in My tournaments; we email you a link to sign in. No password" onClick={() => setD({ ...d, keep: "email" })} />
            <Tile on={d.keep === "pin"} title="Use a PIN" note="4 to 8 numbers you'll type to run it" onClick={() => setD({ ...d, keep: "pin" })} />
          </Tiles>
          {d.keep === "email" && (
            <div className="field">
              <label htmlFor="wz-email">Your email</label>
              <input id="wz-email" className="wz-input" type="email" inputMode="email" autoComplete="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
            </div>
          )}
          {d.keep === "pin" && (
            <div className="field">
              <label htmlFor="wz-pin">Organiser PIN</label>
              <input id="wz-pin" className="wz-input" inputMode="numeric" autoComplete="off" value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="4 to 8 numbers" />
            </div>
          )}
        </>
      )}
      <Summary d={d} onFix={onFix} />
      <Problems d={d} />
      {err && <p className="error">{err}</p>}
      <button type="button" className="btn glow block wz-create" disabled={busy || !okKeep || (!!needOwner && !ownerPin)} onClick={create}>
        {busy ? "Creating…" : "Create my tournament"}
      </button>
    </Screen>
  );
}

function Summary({ d, onFix }: { d: Draft; onFix: (step: string) => void }) {
  const s = settle(d);
  const ps = named(d);
  const Line = SummaryLine;
  return (
    <details className="wz-summary">
      <summary>Check everything</summary>
      <ul>
        <Line step="name" onFix={onFix}>
          <strong>{d.name}</strong>
          {d.subtitle ? `: ${d.subtitle}` : ""}
        </Line>
        <Line step="players" onFix={onFix}>
          {ps.length} player{ps.length === 1 ? "" : "s"}: {ps.map((p) => p.name).join(", ")}
        </Line>
        {d.who === "teams" && <Line step="teams" onFix={onFix}>{d.teams.map((t, i) => t.name.trim() || `Team ${i + 1}`).join(" v ")}</Line>}
        {d.who !== "solo" && d.win && <Line step="win" onFix={onFix}>Winner: {winName(d.win).toLowerCase()}</Line>}
        {s.rounds.map((r, i) => (
          <Line key={i} step={`course:${i}`} onFix={onFix}>
            Round {i + 1}: {r.courseName}
            {r.tee ? `, ${r.tee} tees` : ""}
            {r.holeSet !== "all" ? `, ${r.holeSet === "front" ? "front 9" : "back 9"}` : ""}
            {r.format ? `, ${formatName(r.format).toLowerCase()}` : ""}
            {r.date ? `, ${new Date(r.date).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}` : ""}
            {r.time ? ` at ${r.time}` : ""}
          </Line>
        ))}
        {d.who !== "solo" && <Line step="prizes" onFix={onFix}>Prizes: {d.prizes.length ? d.prizes.map((p) => ({ ctp: "closest the pin", ld: "long drive", nines: "front 9 and back 9", birdies: "most birdies", gir: "most greens", skins: "skins", bestround: "best round" })[p.kind]).join(", ") : "none"}</Line>}
      </ul>
    </details>
  );
}

function SummaryLine({ children, step, onFix }: { children: React.ReactNode; step: string; onFix: (step: string) => void }) {
  return (
    <li>
      {children}{" "}
      <button type="button" className="linklike" onClick={() => onFix(step)}>
        Change
      </button>
    </li>
  );
}
