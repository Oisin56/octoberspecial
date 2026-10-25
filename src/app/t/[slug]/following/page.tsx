"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";

interface Fan {
  id: string;
  name: string;
  how: string | null;
  muted: boolean;
}

interface Following {
  following: Fan[];
  asking: Fan[];
  others: number;
  organiser: boolean;
}

/**
 * Who's following, for the players and organisers: everyone who gave a name (and how they know the group), and a
 * count of everyone else watching. In a private tournament, the people asking to follow, to let in or not.
 */
export default function WhoIsFollowing() {
  const { api, session, sessionReady, state, href } = useT();
  const [data, setData] = useState<Following | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const crew = session?.role === "organiser" || session?.role === "player";

  const load = useCallback(async () => {
    const r = await api("/api/fans", { action: "list" });
    if (r.ok) setData(r.j as unknown as Following);
    else setErr(String(r.j.error ?? "Couldn't load"));
  }, [api]);
  useEffect(() => {
    if (!crew) return;
    const t = setTimeout(load, 0);
    const poll = setInterval(load, 15000);
    return () => (clearTimeout(t), clearInterval(poll));
  }, [crew, load]);

  async function decide(fan: Fan, decision: "approve" | "decline" | "remove" | "mute" | "unmute") {
    if (decision === "remove" && !confirm(`Remove ${fan.name}? ${priv ? "They won't be able to see the tournament any more." : "Their name comes off this list and they can't comment."}`)) return;
    setBusy(fan.id);
    setErr(null);
    const r = await api("/api/fans", { action: "decide", fanId: fan.id, decision });
    setBusy(null);
    if (r.ok) setData(r.j as unknown as Following);
    else setErr(String(r.j.error ?? "That didn't work. Try again."));
  }

  const priv = state?.tournament.privacy === "private";
  if (!sessionReady) return <Loading />;
  if (!crew)
    return (
      <p>
        This is for the players and organisers. <Link href={href("/login")}>Sign in</Link>.
      </p>
    );
  if (!data) return err ? <p className="error">{err}</p> : <Loading />;

  return (
    <div className="stack following">
      <h1>Who&apos;s following</h1>
      <p className="lead">{priv ? "Only the players and the people you let in can see this tournament." : "Anyone with the link can follow. Here's who has told you who they are."}</p>
      {err && <p className="error">{err}</p>}

      {priv && data.asking.length > 0 && (
        <section className="panel stack" aria-label="Asking to follow">
          <h2>
            {data.asking.length} asking to follow
          </h2>
          <ul className="fol-list">
            {data.asking.map((f) => (
              <li key={f.id}>
                <span className="fol-who">
                  <strong>{f.name}</strong>
                  {f.how && <span>{f.how}</span>}
                </span>
                <span className="fol-acts">
                  <button className="btn" disabled={busy === f.id} onClick={() => decide(f, "approve")}>
                    Let in
                  </button>
                  <button className="btn secondary" disabled={busy === f.id} onClick={() => decide(f, "decline")}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: 0 }}>
            They&apos;re emailed when they&apos;re let in. Nobody is told if they&apos;re declined.
          </p>
        </section>
      )}

      <section className="panel stack" aria-label="Following">
        <h2>{data.following.length ? `${data.following.length} following` : priv ? "Nobody let in yet" : "Nobody's given their name yet"}</h2>
        {data.following.length > 0 && (
          <ul className="fol-list">
            {data.following.map((f) => (
              <li key={f.id}>
                <span className="fol-who">
                  <strong>{f.name}</strong>
                  {f.how && <span>{f.how}</span>}
                  {f.muted && <span className="fol-muted">Can&apos;t comment</span>}
                </span>
                {data.organiser && (
                  <span className="fol-acts">
                    <button className="chip" disabled={busy === f.id} onClick={() => decide(f, f.muted ? "unmute" : "mute")}>
                      {f.muted ? "Let comment" : "Stop commenting"}
                    </button>
                    <button className="chip" disabled={busy === f.id} onClick={() => decide(f, "remove")}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!priv && data.others > 0 && (
          <p style={{ margin: 0 }}>
            And {data.others} other{data.others === 1 ? "" : "s"} watching.
          </p>
        )}
      </section>
    </div>
  );
}
