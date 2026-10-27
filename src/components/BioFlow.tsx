"use client";

import { useState } from "react";
import { useT } from "./Providers";
import { mediaUrl } from "@/lib/supabase";

/**
 * The player bio, one question per screen, each with Skip. Every answer is saved as you go; the last screen shows it as
 * the commentators will have it. Starts from whatever the organiser (or an earlier trip) already filled in.
 */

const CLUBS = ["Driver", "Woods", "Hybrid", "Irons", "Wedges", "Putter"];
const WEAKNESSES = ["Three-putts", "The slice", "Bunkers", "The 19th hole"];
type Field = "home_club" | "best_club" | "worst_club" | "weakness" | "nickname" | "photo_path";
const STEPS: Field[] = ["home_club", "best_club", "worst_club", "weakness", "nickname", "photo_path"];
const QUESTION: Record<Field, string> = {
  home_club: "Your home club",
  best_club: "Best club in the bag",
  worst_club: "Worst club in the bag",
  weakness: "Known weakness",
  nickname: "Nickname",
  photo_path: "A photo of you",
};
const HINT: Partial<Record<Field, string>> = {
  nickname: "If the lads have one for you. Optional.",
  photo_path: "For the players page and your film. Optional.",
};

export function BioFlow({ initial, name, onFinish, intro = true }: { initial: Record<string, string | null>; name: string; onFinish: () => void; intro?: boolean }) {
  const { api } = useT();
  const [bio, setBio] = useState<Record<string, string | null>>(initial);
  const [at, setAt] = useState(intro ? -1 : 0);
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const field = STEPS[at];

  async function save(patch: Record<string, string | null>, done = false) {
    setBusy(true);
    setErr(null);
    const r = await api("/api/player", { action: "bio", bio: patch, done });
    setBusy(false);
    if (!r.ok) {
      setErr(String(r.j.error ?? "That didn't save. Try again."));
      return false;
    }
    setBio((b) => ({ ...b, ...patch }));
    return true;
  }
  async function answer(v: string | null) {
    if (v !== undefined && field && (await save({ [field]: v }))) setAt(at + 1);
  }
  const skip = () => setAt(at + 1);

  async function photo(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api("/api/upload-url", { filename: file.name, contentType: file.type || "image/jpeg" });
      if (!r.ok) throw new Error(String(r.j.error ?? "Upload failed"));
      const fd = new FormData();
      fd.append("cacheControl", "3600");
      fd.append("", file);
      const up = await fetch(String(r.j.signedUrl), { method: "PUT", body: fd, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "false" } });
      if (!up.ok) throw new Error("Upload failed");
      setBusy(false);
      if (await save({ photo_path: String(r.j.path) })) setAt(at + 1);
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }

  if (at === -1)
    return (
      <section className="bio-flow" aria-label="Your player bio">
        <h1>Give the commentators something to work with</h1>
        <p className="lead">Six quick questions. About 30 seconds.</p>
        <button className="btn big block" onClick={() => setAt(0)}>
          Complete player bio
        </button>
        <button
          className="btn secondary big block"
          onClick={async () => {
            await api("/api/player", { action: "later" });
            onFinish();
          }}
        >
          Later
        </button>
      </section>
    );

  if (at >= STEPS.length) {
    const facts: [string, string | null][] = [
      ["Home club", bio.home_club],
      ["Best club", bio.best_club],
      ["Worst club", bio.worst_club],
      ["Known weakness", bio.weakness],
      ["Nickname", bio.nickname],
    ];
    const pic = mediaUrl(bio.photo_path);
    return (
      <section className="bio-flow" aria-label="Your player bio">
        <h1>Your player bio</h1>
        <p className="lead">This is what the commentators will know about you. You can change it any time from the players page.</p>
        <div className="bio-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pic ? <img src={pic} alt="" /> : <span className="bio-face">{name[0]}</span>}
          <div>
            <strong>
              {name}
              {bio.nickname ? ` “${bio.nickname}”` : ""}
            </strong>
            <dl className="facts">
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        </div>
        <button className="btn big block" disabled={busy} onClick={async () => (await save({}, true)) && onFinish()}>
          Done
        </button>
        <button className="linkish" onClick={() => setAt(0)}>
          Change an answer
        </button>
      </section>
    );
  }

  const isClub = field === "best_club" || field === "worst_club";
  return (
    <section className="bio-flow" aria-label="Your player bio">
      <p className="bio-step">
        {at + 1} of {STEPS.length}
      </p>
      <h1>{QUESTION[field]}</h1>
      {HINT[field] && <p className="lead">{HINT[field]}</p>}
      {isClub ? (
        <div className="bio-tiles">
          {CLUBS.map((c) => (
            <button key={c} className={`bio-tile${bio[field] === c ? " on" : ""}`} disabled={busy} onClick={() => answer(c)}>
              {c}
            </button>
          ))}
        </div>
      ) : field === "weakness" ? (
        <>
          <div className="bio-tiles">
            {WEAKNESSES.map((c) => (
              <button key={c} className={`bio-tile${bio.weakness === c ? " on" : ""}`} disabled={busy} onClick={() => answer(c)}>
                {c}
              </button>
            ))}
          </div>
          <form
            className="bio-own"
            onSubmit={(e) => {
              e.preventDefault();
              if (own.trim()) answer(own.trim());
            }}
          >
            <label className="field">
              <span className="lbl">Or your own</span>
              <input value={own} onChange={(e) => setOwn(e.target.value)} maxLength={80} />
            </label>
            <button className="btn big" disabled={busy || !own.trim()}>
              Next
            </button>
          </form>
        </>
      ) : field === "photo_path" ? (
        <>
          {bio.photo_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="bio-photo" src={mediaUrl(bio.photo_path) ?? ""} alt="" />
          )}
          <label className="btn big block bio-upload">
            {busy ? "Uploading…" : bio.photo_path ? "Choose another photo" : "Choose a photo"}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && photo(e.target.files[0])} />
          </label>
        </>
      ) : (
        <TextAnswer key={field} value={bio[field] ?? ""} busy={busy} max={field === "nickname" ? 30 : 60} onAnswer={answer} />
      )}
      {err && <p className="error">{err}</p>}
      <div className="bio-nav">
        {at > 0 && (
          <button className="btn secondary" onClick={() => setAt(at - 1)}>
            Back
          </button>
        )}
        <button className="btn secondary" onClick={skip}>
          Skip
        </button>
      </div>
    </section>
  );
}

function TextAnswer({ value, busy, max, onAnswer }: { value: string; busy: boolean; max: number; onAnswer: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  return (
    <form
      className="bio-own"
      onSubmit={(e) => {
        e.preventDefault();
        onAnswer(v.trim() || null);
      }}
    >
      <input className="bio-input" value={v} onChange={(e) => setV(e.target.value)} maxLength={max} autoFocus />
      <button className="btn big block" disabled={busy || !v.trim()}>
        Next
      </button>
    </form>
  );
}
