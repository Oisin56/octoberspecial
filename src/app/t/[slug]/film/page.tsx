"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { mediaUrl } from "@/lib/supabase";
import { lengthName, type FilmLength, type Shape, type Sound } from "@/lib/film";

interface FilmReel {
  id: string;
  status: "planning" | "draft" | "rendering" | "done" | "failed";
  stage: "plan" | "voices" | "render" | "rendering" | "done" | null;
  error: string | null;
  brief: { sound?: Sound; booth?: 1 | 2; style?: string; length?: number; trackId?: string | null; aspect?: string };
  plan: { title?: string; voiceOn?: boolean } | null;
  video_path: string | null;
  post_id: string | null;
  created_at: string;
  done_at: string | null;
}

interface FilmState {
  unlock: { ok: boolean; missing: string[]; clips: number };
  clips: number;
  shots: number;
  mix: { portrait: number; landscape: number; unknown: number };
  shape: Shape;
  canLeave: boolean;
  lengths: { options: FilmLength[]; best: FilmLength };
  sounds: { id: Sound; name: string; note: string }[];
  styles: { id: string; name: string; note: string }[];
  tracks: { id: string; name: string; mood: string; src: string | null; sec: number }[];
  limits: { per: number; left: number; budgetOk: boolean; busy: boolean };
  ready: { claude: boolean; video: boolean; voice: boolean };
  schemaOk: boolean;
  reels: FilmReel[];
}

interface Answers {
  length?: FilmLength;
  shape?: Shape;
  otherShape?: "fit" | "leave";
  sound?: Sound;
  booth?: 1 | 2;
  style?: string;
  trackId?: string | null;
}

type Step = "length" | "shape" | "sound" | "booth" | "style" | "music" | "go";

const KEY = (slug: string) => `mgs-film-${slug}`;

/** The end-of-tournament film: a few big questions, Make my film, then it's made while the phone is put away. */
function FilmInner() {
  const { href, session, api } = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const [st, setSt] = useState<FilmState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reelId, setReelId] = useState<string | null>(sp.get("reel"));
  const [making, setMaking] = useState(sp.get("new") === "1");
  const load = async () => {
    const r = await api("/api/film", { action: "state" });
    if (!r.ok) return setErr(String(r.j.error ?? "Couldn't load"));
    setSt(r.j as unknown as FilmState);
  };
  useEffect(() => {
    if (session?.role !== "organiser") return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.role]);

  if (session && session.role !== "organiser") return <p className="article">Only the organiser makes the film. It&apos;ll be in Highlights when it&apos;s ready.</p>;
  if (!session) return <Loading />;
  if (err) return <p className="error">{err}</p>;
  if (!st) return <Loading />;

  // The film being made (or the last one): its progress, or the finished film
  const current = reelId ? st.reels.find((r) => r.id === reelId) : !making ? st.reels[0] : undefined;
  if (current && !making)
    return (
      <FilmProgress
        key={current.id}
        initial={current}
        left={st.limits.left}
        onAnother={() => {
          setReelId(null);
          setMaking(true);
          router.replace(href("/film?new=1"));
        }}
        onDone={load}
      />
    );

  if (!st.schemaOk) return <p className="notice article">Films need the latest database update. Run supabase/schema.sql in Supabase, then come back.</p>;
  if (!st.unlock.ok) return <FilmLocked st={st} />;
  if (!st.ready.claude || !st.ready.video) return <p className="notice article">Films aren&apos;t set up on this site yet: the AI writer or the video service is missing.</p>;
  if (st.limits.left <= 0) return <p className="notice article">This tournament has made all {st.limits.per} of its films. The site owner can allow more.</p>;
  if (!st.limits.budgetOk) return <p className="notice article">This month&apos;s film budget for the site is used up. It resets on the 1st.</p>;
  return (
    <FilmQuestions
      st={st}
      onMade={(id) => {
        setMaking(false);
        setReelId(id);
        router.replace(href(`/film?reel=${id}`));
        load();
      }}
    />
  );
}

function FilmLocked({ st }: { st: FilmState }) {
  const { href } = useT();
  return (
    <section className="wz-screen film-locked">
      <p className="wz-label">The film</p>
      <h1 className="wz-q">Made once the tournament is over</h1>
      <p className="wz-hint">One film of the whole tournament, with every round, the best shots and the final standings. Still to do:</p>
      <ul className="film-missing">
        {st.unlock.missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="muted">{st.clips ? `${st.clips} clip${st.clips === 1 ? "" : "s"} filmed so far.` : "No clips filmed yet."} Clips from every round go into Highlights as they&apos;re filmed.</p>
      <Link className="btn secondary block" href={href("/admin")}>
        Organiser home
      </Link>
    </section>
  );
}

// ------------------------------------------------------------ the questions

function FilmQuestions({ st, onMade }: { st: FilmState; onMade: (id: string) => void }) {
  const { slug, api } = useT();
  const mixed = st.mix.portrait > 0 && st.mix.landscape > 0;
  const [a, setA] = useState<Answers>(() => {
    let last: Answers = {};
    try {
      last = JSON.parse(localStorage.getItem(KEY(slug)) ?? "{}");
    } catch {}
    return {
      length: last.length && st.lengths.options.includes(last.length) ? last.length : st.lengths.best,
      shape: last.shape ?? st.shape,
      otherShape: last.otherShape ?? "fit",
      sound: last.sound ?? "commentary",
      booth: last.booth ?? 2,
      style: last.style ?? "classic",
      trackId: last.trackId !== undefined && (last.trackId === null || st.tracks.some((x) => x.id === last.trackId)) ? last.trackId : st.tracks[0]?.id ?? null,
    };
  });
  const steps = useMemo<Step[]>(
    () => ["length", ...(mixed ? (["shape"] as Step[]) : []), "sound", ...(a.sound !== "own" && st.ready.voice ? (["booth", "style"] as Step[]) : []), ...(st.tracks.length ? (["music"] as Step[]) : []), "go"],
    [mixed, a.sound, st.tracks.length, st.ready.voice],
  );
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = (p: Partial<Answers> = {}) => {
    setA((x) => ({ ...x, ...p }));
    setI((n) => n + 1);
    window.scrollTo({ top: 0 });
  };
  const back = () => setI((n) => Math.max(0, n - 1));

  async function make() {
    setBusy(true);
    setErr(null);
    try {
      localStorage.setItem(KEY(slug), JSON.stringify(a));
    } catch {}
    const r = await api("/api/film", { action: "make", brief: { ...a, booth: a.booth } });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "Couldn't start the film"));
    onMade((r.j.reel as { id: string }).id);
  }

  const other = a.shape === "portrait" ? st.mix.landscape : st.mix.portrait;
  const label = `${i + 1} of ${steps.length}`;
  return (
    <div className="film-flow">
      {i > 0 && (
        <button type="button" className="wz-back film-back" onClick={back}>
          ‹ Back
        </button>
      )}
      {step === "length" && (
        <Q q="How long?" label={label} hint={`${st.shots} shot${st.shots === 1 ? "" : "s"} filmed${st.clips > st.shots ? `, plus ${st.clips - st.shots === 1 ? "an interview or the like" : `${st.clips - st.shots} interviews and the like`}` : ""}.`}>
          <div className="wz-tiles">
            {([180, 300, 480] as FilmLength[]).map((l) => (
              <Tile key={l} on={a.length === l} title={lengthName(l)} note={l === st.lengths.best ? "Best for your clips" : !st.lengths.options.includes(l) ? "Needs more clips" : undefined} disabled={!st.lengths.options.includes(l)} onClick={() => next({ length: l })} />
            ))}
          </div>
        </Q>
      )}
      {step === "shape" && (
        <Q q="What shape?" label={label} hint={`${st.mix.portrait} clip${st.mix.portrait === 1 ? " was" : "s were"} filmed upright and ${st.mix.landscape} wide.`}>
          <div className="wz-tiles">
            <Tile on={a.shape === "portrait"} title="Phone (upright)" note="For WhatsApp, Instagram and Stories" onClick={() => setA({ ...a, shape: "portrait" })} />
            <Tile on={a.shape === "landscape"} title="TV (wide)" note="For YouTube or the telly" onClick={() => setA({ ...a, shape: "landscape" })} />
          </div>
          <p className="film-sub">
            The {other} clip{other === 1 ? "" : "s"} filmed the other way {a.shape === "portrait" ? "will follow the golfer in an upright frame" : "will have soft blurred sides"}
            {st.canLeave ? ", or:" : "."}
          </p>
          {st.canLeave && (
            <div className="wz-yn-b film-other">
              <button type="button" className="pick-tile" aria-pressed={a.otherShape !== "leave"} onClick={() => setA({ ...a, otherShape: "fit" })}>
                Fit them in
              </button>
              <button type="button" className="pick-tile" aria-pressed={a.otherShape === "leave"} onClick={() => setA({ ...a, otherShape: "leave" })}>
                Leave them out
              </button>
            </div>
          )}
          <button type="button" className="btn block wz-next" onClick={() => next()}>
            Next
          </button>
        </Q>
      )}
      {step === "sound" && (
        <Q q="What do you want to hear?" label={label}>
          <div className="wz-tiles">
            {st.sounds
              .filter((x) => x.id === "own" || st.ready.voice)
              .map((x) => (
                <Tile key={x.id} on={a.sound === x.id} title={x.name} note={x.note} onClick={() => next({ sound: x.id })} />
              ))}
          </div>
        </Q>
      )}
      {step === "booth" && (
        <Q q="Who's in the commentary box?" label={label}>
          <div className="wz-tiles">
            <Tile on={a.booth === 1} title="One commentator" note="One voice calls the whole film" onClick={() => next({ booth: 1 })} />
            <Tile on={a.booth === 2} title="A commentator and a pundit" note="The commentator calls the shots; the pundit reacts, like TV" onClick={() => next({ booth: 2 })} />
          </div>
        </Q>
      )}
      {step === "style" && (
        <Q q="How should they sound?" label={label} hint="Tap Hear it for a sample.">
          <div className="film-styles">
            {st.styles.map((x) => (
              <div key={x.id} className="film-style">
                <Tile on={a.style === x.id} title={x.name} note={x.note} onClick={() => next({ style: x.id })} />
                <HearIt style={x.id} booth={a.booth ?? 1} />
              </div>
            ))}
          </div>
        </Q>
      )}
      {step === "music" && (
        <Q q="Music?" label={label} hint="It drops down under the commentary and fades out at the end.">
          <div className="film-styles">
            {st.tracks.map((x) => (
              <div key={x.id} className="film-style">
                <Tile on={a.trackId === x.id} title={x.name} note={x.mood} onClick={() => next({ trackId: x.id })} />
                {x.src && <PlayButton srcs={[x.src]} label="Listen" />}
              </div>
            ))}
            <Tile on={a.trackId === null} title="No music" onClick={() => next({ trackId: null })} />
          </div>
        </Q>
      )}
      {step === "go" && (
        <Q q="Ready to make your film" label={label}>
          <dl className="film-summary">
            <div>
              <dt>Length</dt>
              <dd>{lengthName(a.length ?? 300)}</dd>
            </div>
            <div>
              <dt>Shape</dt>
              <dd>
                {a.shape === "portrait" ? "Phone (upright)" : "TV (wide)"}
                {mixed && a.otherShape === "leave" ? ", other clips left out" : ""}
              </dd>
            </div>
            <div>
              <dt>Sound</dt>
              <dd>{st.sounds.find((x) => x.id === a.sound)?.name}</dd>
            </div>
            {a.sound !== "own" && st.ready.voice && (
              <div>
                <dt>Commentary</dt>
                <dd>
                  {a.booth === 2 ? "Commentator and pundit" : "One commentator"}, {st.styles.find((x) => x.id === a.style)?.name.toLowerCase()}
                </dd>
              </div>
            )}
            {st.tracks.length > 0 && (
              <div>
                <dt>Music</dt>
                <dd>{a.trackId ? st.tracks.find((x) => x.id === a.trackId)?.name : "None"}</dd>
              </div>
            )}
          </dl>
          {err && <p className="error">{err}</p>}
          <button type="button" className="btn block wz-next film-make" disabled={busy} onClick={make}>
            {busy ? "Starting…" : "Make my film"}
          </button>
          <p className="film-sub">
            It takes a few minutes, and you can close the app while it&apos;s made. This tournament can make {st.limits.left} more film{st.limits.left === 1 ? "" : "s"}.
          </p>
        </Q>
      )}
    </div>
  );
}

function Q({ q, label, hint, children }: { q: string; label?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="wz-screen">
      {label && <p className="wz-label">{label}</p>}
      <h1 className="wz-q">{q}</h1>
      {hint && <p className="wz-hint">{hint}</p>}
      <div className="wz-body">{children}</div>
    </section>
  );
}

function Tile({ on, title, note, onClick, disabled }: { on?: boolean; title: string; note?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="wz-tile" aria-pressed={!!on} onClick={onClick} disabled={disabled}>
      <span className="wz-t">{title}</span>
      {note && <span className="wz-n">{note}</span>}
    </button>
  );
}

/** Play one or more recordings, one after the other. */
function PlayButton({ srcs, label = "Hear it", loading }: { srcs: string[]; label?: string; loading?: boolean }) {
  const [on, setOn] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const play = (k = 0) => {
    if (k >= srcs.length) return setOn(false);
    audio.current?.pause();
    const el = new Audio(srcs[k]);
    audio.current = el;
    el.onended = () => play(k + 1);
    el.onerror = () => setOn(false);
    setOn(true);
    el.play().catch(() => setOn(false));
  };
  return (
    <button type="button" className="film-hear" aria-pressed={on} disabled={loading} onClick={() => (on ? (audio.current?.pause(), setOn(false)) : play())}>
      {loading ? "…" : on ? "Stop" : label}
    </button>
  );
}

function HearIt({ style, booth }: { style: string; booth: 1 | 2 }) {
  const { api } = useT();
  const [srcs, setSrcs] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (srcs?.length) return <PlayButton key={`${style}-${booth}`} srcs={srcs} />;
  return (
    <button
      type="button"
      className="film-hear"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await api("/api/film", { action: "sample", style, booth });
        setBusy(false);
        const urls = (r.j.urls as string[] | undefined) ?? [];
        if (!urls.length) return;
        setSrcs(urls);
        // play straight away
        const play = (k: number) => {
          if (k >= urls.length) return;
          const el = new Audio(urls[k]);
          el.onended = () => play(k + 1);
          el.play().catch(() => null);
        };
        play(0);
      }}
    >
      {busy ? "Getting it…" : "Hear it"}
    </button>
  );
}

// ------------------------------------------------------------ while it's made, and when it's ready

const STEPS = (voice: boolean) => [
  { id: "plan", name: "Choosing the shots and writing the script" },
  ...(voice ? [{ id: "voices", name: "Recording the commentary" }] : []),
  { id: "render", name: "Putting it together" },
];

function FilmProgress({ initial, left, onAnother, onDone }: { initial: FilmReel; left: number; onAnother: () => void; onDone: () => void }) {
  const { api, href, state } = useT();
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  const working = r.status === "planning" || r.status === "rendering";
  useEffect(() => {
    if (!working) return;
    const i = setInterval(async () => {
      const x = await api("/api/film", { action: "status", reelId: r.id });
      if (x.ok && x.j.reel) {
        setR(x.j.reel as FilmReel);
        if ((x.j.reel as FilmReel).status === "done") onDone();
      }
    }, 4000);
    return () => clearInterval(i);
  }, [working, r.id, api, onDone]);

  const voice = r.brief.sound !== "own";
  const steps = STEPS(voice);
  const at = r.stage === "rendering" ? "render" : r.stage ?? "plan";
  const idx = Math.max(0, steps.findIndex((s) => s.id === at));

  if (r.status === "draft")
    return (
      <section className="film-prod">
        <h1 className="wz-q">Your changes are saved</h1>
        <p className="film-sub">Make the film again to see them. Anything that hasn&apos;t changed is reused.</p>
        <button
          type="button"
          className="btn block"
          disabled={busy || left <= 0}
          onClick={async () => {
            setBusy(true);
            const x = await api("/api/film", { action: "again", reelId: r.id });
            setBusy(false);
            if (x.ok) setR(x.j.reel as FilmReel);
          }}
        >
          {left <= 0 ? "No films left for this tournament" : busy ? "Starting…" : "Make the film again"}
        </button>
        <Link className="btn secondary block" href={href(`/film/studio?reel=${r.id}`)}>
          Back to the film studio
        </Link>
      </section>
    );

  if (r.status === "done" && r.video_path) {
    const src = /^https?:/.test(r.video_path) ? r.video_path : mediaUrl(r.video_path)!;
    const page = typeof window !== "undefined" ? `${window.location.origin}${href(`/highlights${r.post_id ? `?v=${r.post_id}` : ""}`)}` : "";
    const name = state?.tournament.name ?? "Our tournament";
    const share = async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: `${name}: the film`, url: page });
          return;
        } catch {}
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(`${name}: the film ${page}`)}`, "_blank");
    };
    return (
      <section className="film-ready">
        <p className="wz-label">Your film</p>
        <h1 className="wz-q">{r.plan?.title ?? name}</h1>
        <video className={`film-video${r.brief.aspect === "9:16" ? " upright" : ""}`} src={src} poster={`${src}.jpg`} controls playsInline preload="metadata" />
        {r.error && <p className="notice small">{r.error}</p>}
        <div className="film-actions">
          <button type="button" className="btn block" onClick={share}>
            Share
          </button>
          <a className="btn secondary block" href={src} download={`${name}.mp4`}>
            Save to this phone
          </a>
          <Link className="btn secondary block" href={href(`/film/studio?reel=${r.id}`)}>
            Change something
          </Link>
          {left > 0 && (
            <button type="button" className="btn secondary block" onClick={onAnother}>
              Make another version
            </button>
          )}
        </div>
        <p className="film-sub">It&apos;s in Highlights for everyone. {left > 0 ? `${left} more film${left === 1 ? "" : "s"} can be made for this tournament.` : ""}</p>
      </section>
    );
  }

  return (
    <section className="film-prod" aria-live="polite">
      <svg className="clapper" viewBox="0 0 120 100" aria-hidden="true">
        <g className="clapper-top">
          <rect x="10" y="14" width="100" height="18" rx="3" />
          <path d="M22 14l14 18M46 14l14 18M70 14l14 18M94 14l12 15" />
        </g>
        <rect x="10" y="36" width="100" height="56" rx="4" />
        <path d="M10 52h100" />
      </svg>
      <h1 className="wz-q">{r.status === "failed" ? "The film didn't finish" : "Your film is in production"}</h1>
      <ol className="film-steps">
        {steps.map((s, k) => (
          <li key={s.id} className={r.status === "failed" ? (k < idx ? "done" : k === idx ? "stuck" : "") : k < idx ? "done" : k === idx ? "now" : ""}>
            <span className="tick" aria-hidden="true" />
            {s.name}
          </li>
        ))}
        <li className={r.status === "failed" ? "" : ""}>
          <span className="tick" aria-hidden="true" />
          Ready to watch
        </li>
      </ol>
      {r.status === "failed" ? (
        <>
          <p className="notice">{r.error ?? "Something went wrong."}</p>
          <button
            type="button"
            className="btn block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const x = await api("/api/film", { action: "retry", reelId: r.id });
              setBusy(false);
              if (x.ok) setR(x.j.reel as FilmReel);
            }}
          >
            {busy ? "Starting…" : "Try again"}
          </button>
          <p className="film-sub">Anything already done (the script, the voices) is kept, so it isn&apos;t paid for twice.</p>
        </>
      ) : (
        <p className="film-sub">This usually takes a few minutes. You can close the app: the film carries on, and it&apos;ll be in Highlights when it&apos;s ready. If you signed in with your email, we&apos;ll email you too.</p>
      )}
    </section>
  );
}

export default function FilmPage() {
  return (
    <Suspense fallback={<Loading />}>
      <FilmInner />
    </Suspense>
  );
}
