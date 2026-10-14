"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { uploadBlob } from "@/lib/upload";
import { filmClips, clipTypeOf, CLIP_TYPES, SEAT_NAMES, type Seat } from "@/lib/film";
import { LINE_PARTS, lineRecorded, lineText, recordingOf, seatOf, type ClipSegment, type LinePart, type Plan, type Segment } from "@/lib/director-types";

interface Voice {
  id: string;
  name: string;
  note: string;
  preview: string | null;
  gender: string;
  accent: string;
}
interface Track {
  id: string;
  name: string;
  mood: string;
}

const PART_NAME: Record<LinePart, string> = { voice: "Set-up", payoff: "Reaction", replay: "Over the replay" };

/** The film studio: change anything in a finished film, then make it again. */
function StudioInner() {
  const { api, href, state, slug, session } = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const reelId = sp.get("reel");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [left, setLeft] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (session?.role !== "organiser" || !reelId) return;
    const t = setTimeout(async () => {
      const [list, v, st] = await Promise.all([api("/api/director", { action: "list" }), api("/api/film", { action: "voices" }), api("/api/film", { action: "state" })]);
      const reel = ((list.j.reels as { id: string; plan: Plan | null; status: string }[]) ?? []).find((r) => r.id === reelId);
      if (!reel?.plan) return setErr("That film wasn't found.");
      setPlan(reel.plan);
      setStatus(reel.status);
      setVoices((v.j.voices as Voice[]) ?? []);
      setTracks((st.j.tracks as Track[]) ?? []);
      setLeft(Number((st.j.limits as { left?: number })?.left ?? 0));
    }, 0);
    return () => clearTimeout(t);
  }, [session?.role, reelId, api]);

  const change = (p: Plan) => {
    setPlan(p);
    setDirty(true);
    setMsg(null);
  };
  const seg = (id: string, patch: Partial<Segment>) => plan && change({ ...plan, segments: plan.segments.map((s) => (s.id === id ? ({ ...s, ...patch } as Segment) : s)) });

  async function save(): Promise<Plan | null> {
    if (!plan) return null;
    setBusy("save");
    const r = await api("/api/director", { action: "save", reelId, plan });
    setBusy(null);
    if (!r.ok) {
      setMsg(String(r.j.error ?? "Didn't save"));
      return null;
    }
    setPlan(r.j.plan as Plan);
    setDirty(false);
    setMsg("Saved");
    return r.j.plan as Plan;
  }

  async function hearNew() {
    if (dirty && !(await save())) return;
    setBusy("record");
    for (let i = 0; i < 6; i++) {
      const r = await api("/api/director", { action: "voiceRecord", reelId });
      if (!r.ok) {
        setMsg(String(r.j.error ?? "The voices didn't record"));
        break;
      }
      setPlan(r.j.plan as Plan);
      if (!Number(r.j.remaining)) {
        setMsg("The new lines are recorded. Tap Hear on any of them.");
        break;
      }
    }
    setBusy(null);
  }

  async function makeAgain() {
    if (dirty && !(await save())) return;
    setBusy("again");
    const r = await api("/api/film", { action: "again", reelId });
    setBusy(null);
    if (!r.ok) return setMsg(String(r.j.error ?? "Couldn't start the film"));
    router.push(href(`/film?reel=${reelId}`));
  }

  async function own(s: Segment, part: LinePart, file: Blob | null, sec = 0) {
    if (dirty && !(await save())) return;
    setBusy(`own-${s.id}-${part}`);
    try {
      const path = file ? await uploadBlob(file, { t: slug, contentType: "audio/wav", filename: "own.wav" }) : null;
      const r = await api("/api/director", { action: "ownLine", reelId, segId: s.id, part, path, sec });
      if (!r.ok) throw new Error(String(r.j.error ?? "Didn't save"));
      setPlan(r.j.plan as Plan);
      setMsg(file ? "Your recording is in" : "Back to the AI voice");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Didn't save");
    }
    setBusy(null);
  }

  const available = useMemo(() => (state && plan ? filmClips(state).filter((c) => !plan.segments.some((s) => s.kind === "clip" && s.postId === c.id)) : []), [state, plan]);

  if (session && session.role !== "organiser") return <p className="article">Only the organiser can change the film.</p>;
  if (err) return <p className="error">{err}</p>;
  if (!plan || !state) return <Loading />;
  const locked = status === "planning" || status === "rendering";
  const booth = plan.booth === 2 ? 2 : 1;

  function move(i: number, d: -1 | 1) {
    const segs = [...plan!.segments];
    const j = i + d;
    if (j < 0 || j >= segs.length) return;
    [segs[i], segs[j]] = [segs[j], segs[i]];
    change({ ...plan!, segments: segs });
  }
  function addClip(id: string) {
    const c = available.find((x) => x.id === id);
    if (!c) return;
    const round = state!.rounds.find((r) => r.id === c.round_id);
    const s: ClipSegment = {
      id: Math.random().toString(36).slice(2, 10),
      kind: "clip",
      postId: c.id,
      src: "",
      caption: (c.body ?? "").slice(0, 40),
      in: c.trim_in != null ? Number(c.trim_in) : 0,
      out: c.trim_out != null ? Number(c.trim_out) : null,
      round: round?.number ?? null,
      hole: c.hole,
      playerIds: c.player_ids ?? [],
      bug: clipTypeOf(c) === "shot",
      clipType: clipTypeOf(c) === "shot" ? undefined : clipTypeOf(c),
      portrait: c.details?.shape ? c.details.shape === "portrait" : undefined,
      duration: c.details?.dur != null ? Number(c.details.dur) : null,
    };
    const segs = [...plan!.segments];
    const lastCard = segs.length - 1 >= 0 && segs[segs.length - 1].kind === "card" ? segs.length - 1 : segs.length;
    segs.splice(lastCard, 0, s);
    change({ ...plan!, segments: segs });
  }

  return (
    <div className="studio">
      <Link className="back-home" href={href(`/film?reel=${reelId}`)}>
        <span aria-hidden>←</span> Your film
      </Link>
      <h1>Film studio</h1>
      {locked && <p className="notice">This film is being made right now. You can change it once it&apos;s finished.</p>}
      <label className="field">
        <span>Film title</span>
        <input value={plan.title} disabled={locked} onChange={(e) => change({ ...plan, title: e.target.value })} />
      </label>

      {plan.voiceOn && (
        <section className="panel stack">
          <h2>The commentary team</h2>
          <div className="wz-yn-b">
            <button type="button" className="pick-tile" aria-pressed={booth === 1} disabled={locked} onClick={() => change({ ...plan, booth: 1 })}>
              One commentator
            </button>
            <button type="button" className="pick-tile" aria-pressed={booth === 2} disabled={locked} onClick={() => change({ ...plan, booth: 2, voice2Id: plan.voice2Id ?? voices.find((v) => v.gender === "female")?.id })}>
              Commentator and pundit
            </button>
          </div>
          <SeatPicker seat={1} voices={voices} value={plan.voiceId} disabled={locked} onChange={(id) => change({ ...plan, voiceId: id })} />
          {booth === 2 && <SeatPicker seat={2} voices={voices} value={plan.voice2Id} disabled={locked} onChange={(id) => change({ ...plan, voice2Id: id })} />}
          {!voices.length && <p className="muted small">The voice list isn&apos;t available, so the film keeps its voices.</p>}
        </section>
      )}

      <section className="panel stack">
        <h2>Music</h2>
        {tracks.length ? (
          <div className="studio-tracks">
            {tracks.map((x) => (
              <button key={x.id} type="button" className="pick-tile" aria-pressed={plan.music?.source === "track" && plan.music.trackId === x.id} disabled={locked} onClick={() => change({ ...plan, music: { source: "track", mood: "epic", trackId: x.id } })}>
                {x.name}
              </button>
            ))}
            <button type="button" className="pick-tile" aria-pressed={plan.music?.source === "none"} disabled={locked} onClick={() => change({ ...plan, music: { source: "none", mood: "epic" } })}>
              No music
            </button>
          </div>
        ) : (
          <p className="muted small">No music tracks have been added to the site yet.</p>
        )}
        <label className="field">
          <span>Music volume: {Math.round(plan.musicVolume * 100)}%</span>
          <input type="range" min={0} max={100} value={Math.round(plan.musicVolume * 100)} disabled={locked} onChange={(e) => change({ ...plan, musicVolume: Number(e.target.value) / 100 })} />
        </label>
      </section>

      <section className="stack">
        <h2>The film, piece by piece</h2>
        <ol className="studio-list">
          {plan.segments.map((s, i) => (
            <li key={s.id} className={`studio-row ${s.kind}`}>
              <div className="studio-head">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.kind === "clip" ? <img className="studio-thumb" src={`${s.src}.jpg`} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} /> : <span className="studio-thumb card" aria-hidden="true" />}
                <div className="studio-what">
                  <small>
                    {s.kind === "card"
                      ? { title: "Title", chapter: "Round", result: "Round result", standings: "Final standings" }[s.card]
                      : s.kind === "clip"
                        ? s.clipType && s.clipType !== "shot"
                          ? CLIP_TYPES[s.clipType as Exclude<typeof s.clipType, "shot">].name
                          : `Round ${s.round ?? "?"}${s.hole ? ` · hole ${s.hole}` : ""}`
                        : "AI shot"}
                  </small>
                  {s.kind === "card" ? (
                    <input aria-label="Heading" value={s.heading} disabled={locked} onChange={(e) => seg(s.id, { heading: e.target.value })} />
                  ) : s.kind === "clip" ? (
                    <input aria-label="Caption" value={s.caption} disabled={locked} onChange={(e) => seg(s.id, { caption: e.target.value })} />
                  ) : (
                    <span>Scenery</span>
                  )}
                </div>
                <div className="studio-move">
                  <button type="button" className="chip" aria-label="Move up" disabled={locked || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="chip" aria-label="Move down" disabled={locked || i === plan.segments.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  {s.kind !== "card" && (
                    <button type="button" className="chip" aria-label="Take it out" disabled={locked} onClick={() => change({ ...plan, segments: plan.segments.filter((x) => x.id !== s.id) })}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {plan.voiceOn &&
                LINE_PARTS.filter((part) => (part === "voice" ? true : s.kind === "clip" && (!s.clipType || s.clipType === "shot") && (part === "payoff" ? !s.leadIn : !!s.replay))).map((part) => (
                  <LineRow
                    key={part}
                    plan={plan}
                    s={s}
                    part={part}
                    booth={booth}
                    locked={locked}
                    busy={busy === `own-${s.id}-${part}`}
                    onText={(text) => seg(s.id, (part === "voice" ? { voice: text, voiceAuto: undefined } : part === "payoff" ? { payoff: text, payoffAuto: undefined } : { replayVoice: text, replayAuto: undefined }) as Partial<Segment>)}
                    onSeat={(seat) => seg(s.id, { seats: { ...(s.seats ?? {}), [part]: seat } })}
                    onOwn={(file, sec) => own(s, part, file, sec)}
                  />
                ))}
            </li>
          ))}
        </ol>
        {available.length > 0 && (
          <label className="field">
            <span>Add a clip</span>
            <select value="" disabled={locked} onChange={(e) => e.target.value && addClip(e.target.value)}>
              <option value="">Choose a clip…</option>
              {available.map((c) => {
                const r = state.rounds.find((x) => x.id === c.round_id);
                const type = clipTypeOf(c);
                return (
                  <option key={c.id} value={c.id}>
                    {type !== "shot" ? `${CLIP_TYPES[type].name}: ` : `R${r?.number ?? "?"}${c.hole ? ` h${c.hole}` : ""}: `}
                    {(c.body ?? c.author_name).slice(0, 50)}
                  </option>
                );
              })}
            </select>
          </label>
        )}
      </section>

      <div className="studio-bar">
        {msg && <p className={/saved|recorded|is in|back to/i.test(msg) ? "small" : "error small"}>{msg}</p>}
        <div className="row">
          {dirty && (
            <button type="button" className="btn secondary" disabled={!!busy || locked} onClick={save}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
          )}
          {plan.voiceOn && (
            <button type="button" className="btn secondary" disabled={!!busy || locked} onClick={hearNew}>
              {busy === "record" ? "Recording…" : "Record the new lines"}
            </button>
          )}
          <button type="button" className="btn" disabled={!!busy || locked || left <= 0} onClick={makeAgain}>
            {left <= 0 ? "No films left" : busy === "again" ? "Starting…" : "Make the film again"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SeatPicker({ seat, voices, value, onChange, disabled }: { seat: Seat; voices: Voice[]; value?: string; onChange: (id: string) => void; disabled?: boolean }) {
  const current = voices.find((v) => v.id === value);
  const [gender, setGender] = useState<string>(current?.gender || "");
  const [accent, setAccent] = useState<string>("");
  const accents = [...new Set(voices.map((v) => v.accent).filter(Boolean))].sort();
  const list = voices.filter((v) => (!gender || v.gender === gender) && (!accent || v.accent === accent));
  if (!voices.length) return null;
  return (
    <div className="seat">
      <strong>{SEAT_NAMES[seat]}</strong>
      <div className="row seat-filters">
        {["", "male", "female"].map((g) => (
          <button key={g || "any"} type="button" className="pick-tile" aria-pressed={gender === g} disabled={disabled} onClick={() => setGender(g)}>
            {g ? g[0].toUpperCase() + g.slice(1) : "Any"}
          </button>
        ))}
        {accents.length > 1 && (
          <select aria-label={`${SEAT_NAMES[seat]} accent`} value={accent} disabled={disabled} onChange={(e) => setAccent(e.target.value)}>
            <option value="">Any accent</option>
            {accents.map((a) => (
              <option key={a} value={a}>
                {a[0].toUpperCase() + a.slice(1)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="row">
        <select aria-label={`${SEAT_NAMES[seat]} voice`} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {!current && <option value={value ?? ""}>{value ? "The film's voice" : "Choose a voice"}</option>}
          {(current && !list.includes(current) ? [current, ...list] : list).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.note ? ` (${v.note})` : ""}
            </option>
          ))}
        </select>
        {current?.preview && (
          <button type="button" className="film-hear" onClick={() => new Audio(current.preview!).play().catch(() => null)}>
            Hear
          </button>
        )}
      </div>
    </div>
  );
}

function LineRow({
  plan,
  s,
  part,
  booth,
  locked,
  busy,
  onText,
  onSeat,
  onOwn,
}: {
  plan: Plan;
  s: Segment;
  part: LinePart;
  booth: 1 | 2;
  locked: boolean;
  busy: boolean;
  onText: (t: string) => void;
  onSeat: (seat: Seat) => void;
  onOwn: (file: Blob | null, sec?: number) => void;
}) {
  const mine = !!s.own?.[part];
  const rec = recordingOf(s, part);
  const recorded = lineRecorded(plan, s, part);
  const seat = seatOf(s, part);
  const text = lineText(s, part);
  return (
    <div className={`studio-line${mine ? " own" : ""}`}>
      <div className="studio-line-h">
        <span>{s.kind === "card" ? "Said over the card" : s.kind === "clip" && s.leadIn && part === "voice" ? "Said before it plays" : PART_NAME[part]}</span>
        {booth === 2 && !mine && (
          <span className="row seat-toggle">
            {([1, 2] as Seat[]).map((x) => (
              <button key={x} type="button" className="chip" aria-pressed={seat === x} disabled={locked} onClick={() => onSeat(x)}>
                {SEAT_NAMES[x]}
              </button>
            ))}
          </span>
        )}
      </div>
      {mine ? (
        <p className="studio-own">Your own recording{rec.sec ? ` (${rec.sec.toFixed(1)}s)` : ""}</p>
      ) : (
        <textarea value={text === "(your recording)" ? "" : text} disabled={locked} placeholder="Nothing said here" onChange={(e) => onText(e.target.value)} />
      )}
      <div className="row studio-line-b">
        {rec.src && (recorded || mine) && (
          <button type="button" className="film-hear" onClick={() => new Audio(rec.src!).play().catch(() => null)}>
            Hear
          </button>
        )}
        {!locked && (busy ? <span className="muted small">Saving…</span> : <VoiceRecorder label={mine ? "Record it again" : "Record it yourself"} onDone={(file, sec) => onOwn(file, sec)} />)}
        {mine && !locked && (
          <button type="button" className="linklike" onClick={() => onOwn(null)}>
            Use the AI voice
          </button>
        )}
      </div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StudioInner />
    </Suspense>
  );
}
