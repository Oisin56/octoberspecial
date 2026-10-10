"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { mediaUrl } from "@/lib/supabase";
import { AWARDS, type PostRow, type TournamentState } from "@/lib/types";

/** One video in the feed: a highlights film or a clip from the course. */
export interface FeedItem {
  post: PostRow;
  src: string;
  poster: string | null;
  film: boolean;
  title: string;
  where: string;
  caption: string;
  /** Trimmed on the phone: play only this part */
  trimIn: number | null;
  trimOut: number | null;
}

/** Films first (newest first), then clips in round and hole order. */
export function feedItems(state: TournamentState, roundFilter: string | null): FeedItem[] {
  const num = (id: string | null) => state.rounds.find((r) => r.id === id)?.number ?? 99;
  const isFilm = (p: PostRow) => (p.body ?? "").startsWith("Highlights reel");
  const vids = state.posts.filter((p) => p.kind === "video" && p.media_path && !p.hidden).filter((p) => !roundFilter || String(num(p.round_id)) === roundFilter);
  const films = vids.filter(isFilm).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const clips = vids.filter((p) => !isFilm(p)).sort((a, b) => num(a.round_id) - num(b.round_id) || (a.hole ?? 0) - (b.hole ?? 0) || a.created_at.localeCompare(b.created_at));
  return [...films, ...clips].map((p) => {
    const r = state.rounds.find((x) => x.id === p.round_id);
    const film = isFilm(p);
    const path = p.media_path!;
    return {
      post: p,
      src: mediaUrl(path)!,
      poster: path.startsWith("http") ? null : mediaUrl(`${path}.jpg`),
      film,
      title: film ? (p.body ?? "").replace(/^Highlights reel:\s*/, "") || "Highlights" : p.hole ? `Hole ${p.hole}` : "From the course",
      where: film ? (r ? `Round ${r.number} highlights` : "Tournament highlights") : r ? `Round ${r.number}, ${r.course_name}` : "",
      caption: film ? "" : [p.author_name, p.body].filter(Boolean).join(": "),
      trimIn: p.trim_in != null ? Number(p.trim_in) : null,
      trimOut: p.trim_out != null ? Number(p.trim_out) : null,
    };
  });
}

function voterId() {
  try {
    let v = localStorage.getItem("os_voter");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("os_voter", v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

const I = {
  sound: (on: boolean) => (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      {on ? (
        <>
          <path d="M16 9.5a3.5 3.5 0 0 1 0 5" />
          <path d="M18.5 7a7 7 0 0 1 0 10" />
        </>
      ) : (
        <path d="M16.5 9.5l5 5m0-5l-5 5" />
      )}
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  ),
  vote: (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.7M17 6h2.5a2.5 2.5 0 0 1-2.6 3.7" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5" />
      <path d="M5 19h14" />
    </svg>
  ),
  up: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 15l6-6 6 6" />
    </svg>
  ),
  down: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
};

/** Phone-style video feed: full screen and swipeable on phones; a phone or cinema frame on laptops. */
export function ReelFeed({
  items,
  state,
  tournamentName,
  backHref,
  api,
  refresh,
  startId,
}: {
  items: FeedItem[];
  state: TournamentState;
  tournamentName: string;
  backHref: string;
  api: (path: string, body: Record<string, unknown>) => Promise<{ ok: boolean; j: Record<string, unknown> }>;
  refresh: () => void;
  startId?: string | null;
}) {
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((x) => x.post.id === startId)));
  const [sound, setSound] = useState(false);
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "share" | "vote" | "awards">(null);
  const [shape, setShape] = useState<Record<string, "portrait" | "landscape">>({});
  const [progress, setProgress] = useState(0);
  const [wide, setWide] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const vids = useRef<Map<string, HTMLVideoElement>>(new Map());

  // The feed takes over the screen: stop the page behind it from scrolling
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const cur = items[Math.min(active, items.length - 1)];

  // Play the one on screen; pause the rest
  useEffect(() => {
    setProgress(0);
    setPaused(false);
    vids.current.forEach((v, id) => {
      if (id === cur?.post.id) {
        v.muted = !sound;
        v.play().catch(() => {
          // Browsers refuse unmuted autoplay until the viewer has tapped: fall back to muted
          v.muted = true;
          setSound(false);
          v.play().catch(() => {});
        });
      } else {
        v.pause();
        try {
          v.currentTime = 0;
        } catch {}
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cur?.post.id, wide]);

  useEffect(() => {
    const v = cur && vids.current.get(cur.post.id);
    if (v) v.muted = !sound;
  }, [sound, cur]);

  // Phone: whichever item fills the screen is the active one
  useEffect(() => {
    if (wide || !scroller.current) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { root: scroller.current, threshold: 0.6 },
    );
    scroller.current.querySelectorAll("[data-i]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [wide, items.length]);

  // Phone: open on the linked video
  useEffect(() => {
    if (wide || !scroller.current || active === 0) return;
    scroller.current.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  const go = useCallback(
    (d: number) => {
      const n = Math.max(0, Math.min(items.length - 1, active + d));
      if (wide) setActive(n);
      else scroller.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [active, items.length, wide],
  );

  // Laptop: arrow keys move between videos, space pauses, M for sound
  useEffect(() => {
    if (!wide) return;
    const key = (e: KeyboardEvent) => {
      if (sheet || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") (e.preventDefault(), go(1));
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") (e.preventDefault(), go(-1));
      if (e.key === " ") (e.preventDefault(), togglePause());
      if (e.key.toLowerCase() === "m") setSound((s) => !s);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, go, sheet]);

  function show(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? null : f)), 900);
  }
  function togglePause() {
    const v = cur && vids.current.get(cur.post.id);
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }
  /** First tap turns the sound on; after that, a tap pauses and plays. */
  function tap() {
    if (!sound) {
      setSound(true);
      show("Sound on");
      return;
    }
    togglePause();
  }

  if (!cur)
    return (
      <div className="reel-empty">
        <p>No videos yet. Clips posted from the course and the highlights films appear here.</p>
      </div>
    );

  const near = (i: number) => Math.abs(i - active) <= 1 || (i === active + 2 && !wide);
  const isPortrait = (it: FeedItem) => (shape[it.post.id] ?? "portrait") === "portrait";

  const video = (it: FeedItem, i: number) => (
    <video
      ref={(el) => {
        if (el) vids.current.set(it.post.id, el);
        else vids.current.delete(it.post.id);
      }}
      src={near(i) ? it.src : undefined}
      poster={it.poster ?? undefined}
      playsInline
      muted
      loop={!it.film}
      preload={i === active || i === active + 1 ? "auto" : "metadata"}
      className="reel-video"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        if (v.videoWidth) setShape((s) => ({ ...s, [it.post.id]: v.videoHeight >= v.videoWidth ? "portrait" : "landscape" }));
        if (it.trimIn) v.currentTime = it.trimIn;
        if (i === active) {
          v.muted = !sound;
          v.play().catch(() => {});
        }
      }}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        // Trimmed clips loop within the chosen part
        const a = it.trimIn ?? 0;
        const b = it.trimOut ?? v.duration;
        if ((it.trimOut && v.currentTime >= it.trimOut) || (it.trimIn && v.currentTime < it.trimIn - 0.2)) v.currentTime = a;
        if (i === active && b > a) setProgress(Math.max(0, Math.min(1, (v.currentTime - a) / (b - a))));
      }}
      onEnded={() => it.film && go(1)}
    />
  );

  const overlay = (it: FeedItem, i: number) => (
    <>
      <div className="reel-shade" />
      <div className="reel-meta">
        <span className="reel-where">{it.where}</span>
        <strong className="reel-title">{it.title}</strong>
        {it.caption && <span className="reel-caption">{it.caption}</span>}
      </div>
      {i === active && <div className="reel-progress" style={{ transform: `scaleX(${progress})` }} />}
      {i === active && !sound && !wide && <span className="reel-hint">Tap for sound</span>}
      {i === active && flash && <span className="reel-flash">{flash}</span>}
      {i === active && paused && <span className="reel-paused" aria-label="Paused" />}
    </>
  );

  const rail = (
    <div className="reel-rail">
      <button onClick={() => setSheet("vote")} aria-label="Vote">
        {I.vote}
        <span>Vote</span>
      </button>
      <button onClick={() => setSheet("share")} aria-label="Share">
        {I.share}
        <span>Share</span>
      </button>
      <button onClick={() => setSound((s) => !s)} aria-label={sound ? "Sound off" : "Sound on"} aria-pressed={sound}>
        {I.sound(sound)}
        <span>{sound ? "Sound" : "Muted"}</span>
      </button>
    </div>
  );

  return (
    <div className={wide ? "reel-stage" : "reel-phone"}>
      {wide ? (
        <>
          <div className="reel-backdrop" style={cur.poster ? { backgroundImage: `url("${cur.poster}")` } : undefined} aria-hidden />
          <div className="reel-top">
            <Link href={backHref} className="reel-back">
              {I.back}
              <span>{tournamentName}</span>
            </Link>
            <button className="reel-awards-btn" onClick={() => setSheet("awards")}>
              Awards
            </button>
          </div>
          <div className="reel-center">
            <div className={isPortrait(cur) ? "device-phone" : "device-cinema"}>
              {isPortrait(cur) && <span className="device-camera" aria-hidden />}
              <div className="device-screen" onClick={togglePause}>
                {items.map((it, i) => (
                  <div key={it.post.id} className="reel-item" hidden={i !== active}>
                    {it.poster && <div className="reel-blur" style={{ backgroundImage: `url("${it.poster}")` }} aria-hidden />}
                    {video(it, i)}
                    {overlay(it, i)}
                  </div>
                ))}
              </div>
            </div>
            <div className="reel-side">
              <button className="reel-nav" onClick={() => go(-1)} disabled={active === 0} aria-label="Previous video">
                {I.up}
              </button>
              <span className="reel-count">
                {active + 1} of {items.length}
              </span>
              <button className="reel-nav" onClick={() => go(1)} disabled={active >= items.length - 1} aria-label="Next video">
                {I.down}
              </button>
              {rail}
              <a className="reel-save" href={`${cur.src}${cur.src.includes("?") ? "&" : "?"}download=${encodeURIComponent(fileName(cur))}`} download={fileName(cur)}>
                {I.save}
                <span>Download</span>
              </a>
            </div>
          </div>
          <p className="reel-keys">Arrow keys to move between videos. Space to pause. M for sound.</p>
        </>
      ) : (
        <>
          <div className="reel-top">
            <Link href={backHref} className="reel-back" aria-label="Back">
              {I.back}
            </Link>
            <span className="reel-heading">Highlights</span>
            <button className="reel-awards-btn" onClick={() => setSheet("awards")}>
              Awards
            </button>
          </div>
          <div className="reel-scroller" ref={scroller}>
            {items.map((it, i) => (
              <section key={it.post.id} className="reel-item" data-i={i} onClick={tap}>
                {it.poster && <div className="reel-blur" style={{ backgroundImage: `url("${it.poster}")` }} aria-hidden />}
                {video(it, i)}
                {overlay(it, i)}
              </section>
            ))}
          </div>
          {rail}
        </>
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(null)}>
          {sheet === "share" && <ShareSheet item={cur} tournamentName={tournamentName} onDone={() => setSheet(null)} />}
          {sheet === "vote" && <VoteSheet item={cur} state={state} api={api} refresh={refresh} />}
          {sheet === "awards" && <AwardsSheet state={state} api={api} refresh={refresh} />}
        </Sheet>
      )}
    </div>
  );
}

function fileName(it: FeedItem) {
  const base = (it.film ? it.title : `${it.where} ${it.title}`).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "golf-clip";
  const ext = it.src.split("?")[0].split(".").pop()?.toLowerCase() ?? "mp4";
  return `${base}.${["mp4", "mov", "webm"].includes(ext) ? ext : "mp4"}`;
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="reel-sheet-wrap" onClick={onClose}>
      <div className="reel-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <span className="reel-grab" aria-hidden />
        {children}
        <button className="reel-sheet-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Share the video itself where the phone allows (straight into Instagram, TikTok, WhatsApp), with a ready caption. */
function ShareSheet({ item, tournamentName, onDone }: { item: FeedItem; tournamentName: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "nofiles">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const caption = useMemo(() => {
    const what = item.film ? `${item.title}: the highlights` : [item.title, item.where].filter(Boolean).join(", ");
    return `${what} from ${tournamentName}. #golf #golftrip`;
  }, [item, tournamentName]);
  const link = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?v=${item.post.id}` : "";

  // Fetch the video as soon as the sheet opens, so the share button works on the first tap
  useEffect(() => {
    let alive = true;
    const probe = new File([new Blob([""], { type: "video/mp4" })], "x.mp4", { type: "video/mp4" });
    if (!navigator.canShare?.({ files: [probe] })) {
      setState("nofiles");
      return;
    }
    setState("loading");
    fetch(item.src)
      .then((r) => r.blob())
      .then((b) => {
        if (!alive) return;
        const name = fileName(item);
        setFile(new File([b], name, { type: b.type || "video/mp4" }));
        setState("ready");
      })
      .catch(() => alive && setState("nofiles"));
    return () => {
      alive = false;
    };
  }, [item]);

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      return true;
    } catch {
      return false;
    }
  }
  async function shareVideo() {
    if (!file) return;
    const copied = await copyCaption();
    try {
      await navigator.share({ files: [file], text: caption });
      onDone();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg("That didn't share. Try Share link instead.");
    }
    if (copied) setMsg("Caption copied: paste it in when you post.");
  }
  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ url: link, text: caption });
        return onDone();
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${caption} ${link}`);
      setMsg("Link and caption copied.");
    } catch {
      setMsg(link);
    }
  }

  return (
    <div className="stack">
      <h3>Share this video</h3>
      <p className="reel-sheet-caption">{caption}</p>
      {state !== "nofiles" && (
        <button className="btn block" disabled={state !== "ready"} onClick={shareVideo}>
          {state === "loading" ? "Getting the video ready…" : "Share the video"}
        </button>
      )}
      <button className={`btn block${state === "nofiles" ? "" : " secondary"}`} onClick={shareLink}>
        Share a link
      </button>
      <a className="btn block secondary" href={`${item.src}${item.src.includes("?") ? "&" : "?"}download=${encodeURIComponent(fileName(item))}`} download={fileName(item)}>
        Save the video
      </a>
      <button className="btn block secondary" onClick={async () => setMsg((await copyCaption()) ? "Caption copied." : caption)}>
        Copy the caption
      </button>
      {state === "ready" && <p className="small muted" style={{ margin: 0 }}>Share the video sends the film itself, so it posts straight into Instagram, TikTok or WhatsApp.</p>}
      {msg && (
        <p className="small" role="status" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
    </div>
  );
}

function useVotes(state: TournamentState, api: (p: string, b: Record<string, unknown>) => Promise<{ ok: boolean }>, refresh: () => void) {
  const [mine, setMine] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("os_my_votes") ?? "{}");
    } catch {
      return {};
    }
  });
  const counts = (award: string) => {
    const c: Record<string, number> = {};
    for (const v of state.votes.filter((x) => x.award === award)) c[v.post_id] = (c[v.post_id] ?? 0) + 1;
    return c;
  };
  async function vote(award: string, postId: string) {
    const r = await api("/api/votes", { award, postId, voter: voterId() });
    if (!r.ok) return;
    const next = { ...mine, [award]: postId };
    setMine(next);
    try {
      localStorage.setItem("os_my_votes", JSON.stringify(next));
    } catch {}
    refresh();
  }
  return { mine, counts, vote };
}

function VoteSheet({ item, state, api, refresh }: { item: FeedItem; state: TournamentState; api: (p: string, b: Record<string, unknown>) => Promise<{ ok: boolean; j: Record<string, unknown> }>; refresh: () => void }) {
  const { mine, counts, vote } = useVotes(state, api, refresh);
  return (
    <div className="stack">
      <h3>Vote for this one</h3>
      <p className="small muted" style={{ margin: 0 }}>
        One vote per award on each phone. You can change it.
      </p>
      {AWARDS.map((a) => (
        <button key={a.id} className={`btn block${mine[a.id] === item.post.id ? "" : " secondary"}`} onClick={() => vote(a.id, item.post.id)}>
          {mine[a.id] === item.post.id ? `Your ${a.label.toLowerCase()} vote` : a.label} ({counts(a.id)[item.post.id] ?? 0})
        </button>
      ))}
    </div>
  );
}

function AwardsSheet({ state, api, refresh }: { state: TournamentState; api: (p: string, b: Record<string, unknown>) => Promise<{ ok: boolean; j: Record<string, unknown> }>; refresh: () => void }) {
  const { mine, counts, vote } = useVotes(state, api, refresh);
  const media = state.posts.filter((p) => (p.kind === "video" || p.kind === "photo") && p.media_path && !p.hidden && !(p.body ?? "").startsWith("Highlights reel"));
  return (
    <div className="stack">
      <h3>Awards</h3>
      {AWARDS.map((a) => {
        const c = counts(a.id);
        const ranked = [...media].sort((x, y) => (c[y.id] ?? 0) - (c[x.id] ?? 0)).slice(0, 6);
        return (
          <div key={a.id} className="stack">
            <strong className="display" style={{ fontSize: 19 }}>
              {a.label}
            </strong>
            {ranked.length === 0 && <span className="small muted">Nothing to vote for yet.</span>}
            {ranked.map((p) => {
              const r = state.rounds.find((x) => x.id === p.round_id);
              return (
                <div key={p.id} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <span className="small">
                    {r ? `R${r.number} ` : ""}
                    {p.hole ? `H${p.hole} ` : ""}
                    {p.author_name}
                    {p.body ? `: ${p.body.slice(0, 40)}` : ""} <span className="muted">({c[p.id] ?? 0})</span>
                  </span>
                  <button className="chip" aria-pressed={mine[a.id] === p.id} onClick={() => vote(a.id, p.id)}>
                    {mine[a.id] === p.id ? "Your vote" : "Vote"}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
