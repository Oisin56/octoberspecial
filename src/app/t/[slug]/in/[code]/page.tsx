"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { landingPath } from "@/lib/landing";

interface Look {
  name: string;
  playerId: string;
  signedInAs: string | null;
  joined: boolean;
  already: boolean;
}

/**
 * A player's personal link. During the trip it works once, on the first phone that says "I'm Neil". Signed in with
 * an email already? It asks whether this is them, so the tournament joins their My golf.
 */
function LinkInner({ code }: { code: string }) {
  const { state, api, reloadSession, href } = useT();
  const router = useRouter();
  const e = useSearchParams().get("e") ?? undefined;
  const [look, setLook] = useState<Look | null>(null);
  const [err, setErr] = useState<{ used: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; role: "organiser" | "player"; playerId?: string } | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api("/api/login", { mode: "link", code, e }).then(async (r) => {
      if (!r.ok) return setErr({ used: r.status === 409, text: String(r.j.error ?? "That link didn't work.") });
      if (r.j.done) {
        // An organiser already signed in here
        await reloadSession();
        return setDone({ name: String(r.j.name), role: "organiser", playerId: r.j.playerId ? String(r.j.playerId) : undefined });
      }
      const l = r.j as unknown as Look;
      // This phone is them already: straight in
      if (l.already) return confirm(false, l);
      setLook(l);
      setSignedIn(!!l.signedInAs);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, code]);

  async function confirm(join: boolean, l = look) {
    if (!l) return;
    setBusy(true);
    const r = await api("/api/login", { mode: "link", code, e, step: "confirm", join });
    setBusy(false);
    if (!r.ok) return setErr({ used: r.status === 409, text: String(r.j.error ?? "That link didn't work.") });
    await reloadSession();
    if (join || e) setSignedIn(true);
    setDone({ name: String(r.j.name), role: r.j.role === "organiser" ? "organiser" : "player", playerId: r.j.playerId ? String(r.j.playerId) : undefined });
  }

  // In: on to their page once the tournament has loaded (straight away when it's a return visit)
  useEffect(() => {
    if (!done || !state || (look && !look.already)) return;
    router.replace(href(landingPath(state, done)));
  }, [done, state, router, href, look]);

  const privacy = (
    <p className="small muted link-privacy">
      By continuing you agree to the <Link href="/privacy">privacy policy</Link>.
    </p>
  );

  if (err)
    return (
      <div className="panel stack link-in">
        <h1>{err.used ? "This link has already been used" : "That link didn't work"}</h1>
        <p className="lead">{err.used ? "It was opened on another phone. Ask the organiser to send you a new one: it's one tap for them." : err.text}</p>
        <Link className="btn secondary block big" href={href("/")}>
          Follow the tournament
        </Link>
      </div>
    );

  if (done && look && !look.already)
    return (
      <div className="panel stack link-in">
        <h1>Welcome, {done.name.split(" ")[0]}</h1>
        <p className="lead">You&apos;re signed in on this phone as {done.name}.</p>
        <Link className="btn block big" href={href(landingPath(state, done))}>
          Let&apos;s go
        </Link>
        {!signedIn && (
          <p className="small muted" style={{ margin: 0 }}>
            Already use the site, or want to get in on another phone or laptop?{" "}
            <Link href="/account">Add your email</Link> to keep all your golf together.
          </p>
        )}
      </div>
    );

  if (!look) return <Loading />;

  if (look.signedInAs && !look.joined)
    return (
      <div className="panel stack link-in">
        <h1>Is this you?</h1>
        <p className="lead">
          You&apos;re signed in as <strong>{look.signedInAs}</strong>. Is this you playing in {state?.tournament.name ?? "this tournament"} as <strong>{look.name}</strong>?
        </p>
        <button className="btn block big" disabled={busy} onClick={() => confirm(true)}>
          Yes, that&apos;s me
        </button>
        <button className="btn secondary block" disabled={busy} onClick={() => confirm(false)}>
          No, just sign this phone in as {look.name.split(" ")[0]}
        </button>
        {privacy}
      </div>
    );

  return (
    <div className="panel stack link-in">
      <p className="link-for">{state?.tournament.name ?? ""}</p>
      <h1>This link is for {look.name}</h1>
      <button className="btn block big link-me" disabled={busy} onClick={() => confirm(!!look.signedInAs)}>
        {busy ? "Signing in…" : `I'm ${look.name.split(" ")[0]}`}
      </button>
      {privacy}
      <p className="small muted" style={{ margin: 0 }}>
        Not {look.name.split(" ")[0]}? <Link href={href("/")}>Just follow the tournament</Link>.
      </p>
    </div>
  );
}

export default function PlayerLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <LinkInner code={code} />
    </Suspense>
  );
}
