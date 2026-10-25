"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT, type ClientSession } from "./Providers";
import { Sheet } from "./Sheet";
import { Paras, timeAgo } from "./ui";
import { cleanBody, cleanTitle } from "@/lib/cleanText";
import { clipUrl, mediaUrl } from "@/lib/supabase";
import { deviceId, myLikerKey, readIds, writeIds } from "@/lib/device";
import { MARKETING_WORDING } from "@/lib/consent";
import { setPendingClip } from "@/lib/pendingClip";
import { clipFile, prefetchClip } from "@/lib/shareFile";
import { currentHole } from "@/lib/scorePos";
import type { AiPieceRow, CommentRow, PostRow, TournamentState } from "@/lib/types";
import { roundBoard } from "@/lib/live";

/**
 * The feed: one column, newest first, like X or Instagram. Clips, highlight films, photos and notes
 * from the course, fans' posts, and the writer's bulletins and reports. Likes need no account;
 * comments and posts need you to be logged in as a player or joined as a fan.
 */

type Item =
  | { k: "post"; id: string; at: string; post: PostRow }
  | { k: "piece"; id: string; at: string; piece: AiPieceRow }
  | { k: "note"; id: string; at: string; comment: CommentRow };

const PAGE = 12;
const isFilm = (p: PostRow) => (p.body ?? "").startsWith("Highlights reel");
const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

type Who = "player" | "fan" | "crew" | "film" | "writer";
const LABEL: Record<Who, string | null> = { player: "Player", fan: "Fan", crew: null, film: "Film", writer: null };

function whoOf(p: { fan_id?: string | null; author_player_id?: string | null }): Who {
  if (p.fan_id) return "fan";
  if (p.author_player_id) return "player";
  return "crew";
}

function isMine(s: ClientSession | null, p: { fan_id?: string | null; author_player_id?: string | null; author_name: string }) {
  if (!s) return false;
  if (s.fanId) return p.fan_id === s.fanId;
  if (p.fan_id) return false;
  return s.playerId ? p.author_player_id === s.playerId : p.author_name === s.name;
}

function where(state: TournamentState, roundId: string | null, hole: number | null) {
  const r = state.rounds.find((x) => x.id === roundId);
  if (!r) return hole ? `Hole ${hole}` : "";
  return hole ? `Round ${r.number}, hole ${hole}` : `Round ${r.number}`;
}

// ------------------------------------------------------------ the feed

export function SocialFeed({ roundId, limit, composer = true }: { roundId?: string; limit?: number; composer?: boolean }) {
  const { state, session, slug, api, refresh, href } = useT();
  const [shown, setShown] = useState(limit ?? PAGE);
  const [sheet, setSheet] = useState<
    | { k: "comments"; post: PostRow }
    | { k: "join"; why: string }
    | { k: "menu"; table: "posts" | "comments"; item: PostRow | CommentRow }
    | { k: "photo"; src: string; alt: string }
    | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<string>>(() => readIds(slug, "reported"));
  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600);
  }, []);

  // A message from the camera (a clip just saved)
  useEffect(() => {
    try {
      const f = sessionStorage.getItem("mgs_flash");
      if (f) {
        sessionStorage.removeItem("mgs_flash");
        window.setTimeout(() => say(f), 0);
      }
    } catch {}
  }, [say]);

  const items = useMemo<Item[]>(() => {
    if (!state) return [];
    const inRound = (id: string | null) => !roundId || id === roundId;
    const posts = state.posts
      .filter((p) => p.visibility === "public" && !p.hidden && inRound(p.round_id) && !reported.has(p.id))
      .filter((p) => (p.kind === "note" ? !!p.body?.trim() : !!p.media_path))
      .map((post) => ({ k: "post" as const, id: post.id, at: post.created_at, post }));
    const pieces = state.pieces
      .filter((p) => p.status === "published" && inRound(p.round_id) && p.body !== "(writing…)")
      .map((piece) => ({ k: "piece" as const, id: piece.id, at: piece.published_at ?? piece.created_at, piece }));
    // Comments from before the feed had comments: shown as posts of their own
    const notes = state.comments
      .filter((c) => !c.post_id && !c.hidden && inRound(c.round_id) && !reported.has(c.id))
      .map((comment) => ({ k: "note" as const, id: comment.id, at: comment.created_at, comment }));
    return [...posts, ...pieces, ...notes].sort((a, b) => b.at.localeCompare(a.at));
  }, [state, roundId, reported]);

  // Load more as you near the bottom
  const more = useRef<HTMLDivElement>(null);
  const total = items.length;
  useEffect(() => {
    if (limit || !more.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setShown((n) => Math.min(n + PAGE, total)), { rootMargin: "600px" });
    io.observe(more.current);
    return () => io.disconnect();
  }, [limit, total]);

  // Opened from a shared link (#p-…): make sure that post is drawn, then go to it
  useEffect(() => {
    const id = window.location.hash.match(/^#p-([\w-]+)$/)?.[1];
    if (!id || !total) return;
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return;
    window.setTimeout(() => setShown((n) => Math.max(n, i + 2)), 0);
    window.setTimeout(() => document.getElementById(`p-${id}`)?.scrollIntoView({ block: "start" }), 120);
    // only when the feed first fills
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total > 0]);

  const likes = useLikes();

  // From the log-in page's "Join the conversation"
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("join") === "1" && !session) window.setTimeout(() => setSheet({ k: "join", why: "post" }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return null;
  const list = items.slice(0, shown);
  const join = (why: string) => setSheet({ k: "join", why });

  async function report(table: "posts" | "comments", id: string) {
    const r = await api("/api/reports", table === "posts" ? { postId: id } : { commentId: id });
    if (!r.ok) return say(String(r.j.error ?? "Couldn't send the report. Try again."));
    const next = new Set(reported).add(id);
    setReported(next);
    writeIds(slug, "reported", next);
    say("Thanks. It's hidden for you, and the organiser will take a look.");
    if (r.j.hidden) refresh();
  }
  async function remove(table: "posts" | "comments", id: string) {
    const r = await api(table === "posts" ? "/api/posts" : "/api/comments", { action: "delete", id });
    if (!r.ok) return say(String(r.j.error ?? "Couldn't delete it. Try again."));
    say("Deleted");
    refresh();
  }
  async function hide(table: "posts" | "comments", id: string) {
    const r = await api("/api/admin", { action: "hide", table, id, hidden: true });
    if (!r.ok) return say(String(r.j.error ?? "Couldn't hide it. Try again."));
    say("Hidden. You can put it back from the Organiser tab, Posts and photos.");
    refresh();
  }

  return (
    <div className="sf">
      {!roundId && <LiveNow />}
      {composer && <Composer roundId={roundId} onJoin={() => join("post")} say={say} />}

      {list.length === 0 && (
        <p className="sf-empty">
          {composer ? "Nothing here yet. Clips, photos and bulletins appear as the rounds are played." : "Nothing yet. Clips, photos and bulletins appear as the rounds are played."}
        </p>
      )}

      {list.map((it) =>
        it.k === "post" ? (
          <PostCard
            key={it.id}
            post={it.post}
            state={state}
            liked={likes.isLiked(it.id)}
            likeCount={likes.count(it.id)}
            onLike={() => likes.toggle(it.id, say)}
            onComments={() => setSheet({ k: "comments", post: it.post })}
            onMenu={() => setSheet({ k: "menu", table: "posts", item: it.post })}
            onPhoto={(src, alt) => setSheet({ k: "photo", src, alt })}
            say={say}
          />
        ) : it.k === "piece" ? (
          <PieceCard key={it.id} piece={it.piece} state={state} say={say} />
        ) : (
          <NoteCard key={it.id} c={it.comment} onMenu={() => setSheet({ k: "menu", table: "comments", item: it.comment })} />
        ),
      )}

      {limit ? (
        total > limit && (
          <Link className="btn secondary block sf-all" href={href("/feed")}>
            See the full feed
          </Link>
        )
      ) : (
        <div ref={more} aria-hidden="true" style={{ height: 1 }} />
      )}

      {sheet?.k === "comments" && (
        <CommentSheet
          post={sheet.post}
          onClose={() => setSheet(null)}
          onJoin={() => join("comment")}
          onMenu={(c) => setSheet({ k: "menu", table: "comments", item: c })}
          say={say}
        />
      )}
      {sheet?.k === "join" && <JoinSheet why={sheet.why} onClose={() => setSheet(null)} say={say} />}
      {sheet?.k === "photo" && (
        <Sheet label="Photo" onClose={() => setSheet(null)} dark>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sf-lightbox" src={sheet.src} alt={sheet.alt} />
        </Sheet>
      )}
      {sheet?.k === "menu" && (
        <MenuSheet
          table={sheet.table}
          item={sheet.item}
          mine={isMine(session, sheet.item)}
          organiser={session?.role === "organiser"}
          onClose={() => setSheet(null)}
          onReport={() => (setSheet(null), report(sheet.table, sheet.item.id))}
          onDelete={() => (setSheet(null), remove(sheet.table, sheet.item.id))}
          onHide={() => (setSheet(null), hide(sheet.table, sheet.item.id))}
        />
      )}
      {toast && (
        <div className="sf-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ likes

/** One like per post per phone: what this phone liked (from the server, kept locally while it catches up). */
function useLikes() {
  const { state, slug, api } = useT();
  const [myKey, setMyKey] = useState<string | null>(null);
  const [mine, setMine] = useState<Record<string, boolean>>({});
  const [kept, setKept] = useState(() => readIds(slug, "liked"));
  useEffect(() => {
    myLikerKey().then(setMyKey);
  }, []);
  const all = state?.likes ?? [];
  const onServer = (id: string) => (myKey ? all.some((l) => l.post_id === id && l.liker === myKey) : kept.has(id));
  const isLiked = (id: string) => mine[id] ?? onServer(id);
  const count = (id: string) => all.filter((l) => l.post_id === id).length + (isLiked(id) ? 1 : 0) - (onServer(id) ? 1 : 0);
  async function toggle(id: string, say: (m: string) => void) {
    const next = !isLiked(id);
    setMine((m) => ({ ...m, [id]: next }));
    const k = new Set(kept);
    if (next) k.add(id);
    else k.delete(id);
    setKept(k);
    writeIds(slug, "liked", k);
    const r = await api("/api/likes", { postId: id, device: deviceId(), like: next });
    if (!r.ok) {
      setMine((m) => ({ ...m, [id]: !next }));
      say(String(r.j.error ?? "Couldn't save the like. Try again."));
    }
  }
  return { isLiked, count, toggle };
}

// ------------------------------------------------------------ cards

function Avatar({ name, who, logo }: { name: string; who: Who; logo?: string | null }) {
  if (logo)
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="sf-av" src={logo} alt="" />;
  return (
    <span className={`sf-av ${who}`} aria-hidden="true">
      {who === "film" ? Ic.play : who === "writer" ? Ic.news : initials(name)}
    </span>
  );
}

function Head({ name, who, at, place, onMenu, logo }: { name: string; who: Who; at: string; place?: string; onMenu?: () => void; logo?: string | null }) {
  const label = LABEL[who];
  return (
    <header className="sf-head">
      <Avatar name={name} who={who} logo={logo} />
      <div className="sf-by">
        <div className="sf-name">
          <strong>{name}</strong>
          {label && <span className={`sf-label ${who}`}>{label}</span>}
        </div>
        <div className="sf-meta">
          {timeAgo(at)}
          {place ? <span className="sf-place">{place}</span> : null}
        </div>
      </div>
      {onMenu && (
        <button className="sf-more" onClick={onMenu} aria-label="More options">
          {Ic.more}
        </button>
      )}
    </header>
  );
}

function PostCard({
  post,
  state,
  liked,
  likeCount,
  onLike,
  onComments,
  onMenu,
  onPhoto,
  say,
}: {
  post: PostRow;
  state: TournamentState;
  liked: boolean;
  likeCount: number;
  onLike: () => void;
  onComments: () => void;
  onMenu: () => void;
  onPhoto: (src: string, alt: string) => void;
  say: (m: string) => void;
}) {
  const { href } = useT();
  const router = useRouter();
  const film = isFilm(post);
  const who: Who = film ? "film" : whoOf(post);
  const name = film ? state.tournament.name : post.author_name;
  const body = film ? cleanTitle((post.body ?? "").replace(/^Highlights reel:\s*/, "")) || "Highlights" : post.body;
  const comments = state.comments.filter((c) => c.post_id === post.id && !c.hidden);
  const last = comments.reduce<CommentRow | null>((a, c) => (!a || c.created_at > a.created_at ? c : a), null);
  const photo = post.kind === "photo" ? mediaUrl(post.media_path) : null;
  const open = () => router.push(href(`/highlights?v=${post.id}`));

  function share() {
    const url = `${window.location.origin}${href(post.kind === "video" ? `/highlights?v=${post.id}` : `/feed#p-${post.id}`)}`;
    const text = film ? `${name}: ${body}` : `${post.author_name}${post.body ? `: ${post.body}` : ""}`;
    // A clip: send the video itself (ready from when it was on screen), with the caption copied to paste in
    const file = post.kind === "video" ? clipFile(post) : null;
    if (file) {
      // the clip's own words (the person who filmed it isn't the story)
      const caption = `${((film ? body : post.body) || text).slice(0, 180)}\n${state.tournament.name}\n${url}`;
      navigator.clipboard?.writeText(caption).catch(() => {});
      navigator
        .share({ files: [file], title: state.tournament.name, text: caption })
        .then(() => say("Shared. The caption is copied too: paste it into your post"))
        .catch(() => {});
      return;
    }
    shareLink(url, text.slice(0, 200), state.tournament.name, say);
  }

  return (
    <article className={`sf-card${film ? " film" : ""}`} id={`p-${post.id}`}>
      <Head name={name} who={who} at={post.created_at} place={film ? "" : where(state, post.round_id, post.hole)} onMenu={onMenu} logo={film ? mediaUrl(state.tournament.logo_path) : null} />
      {body && <p className={`sf-text${film ? " film-title" : ""}${post.kind === "note" && body.length < 90 ? " big" : ""}`}>{body}</p>}
      {post.kind === "video" && <FeedVideo post={post} onOpen={open} shareName={`${state.tournament.name} ${post.hole ? `hole ${post.hole}` : "clip"}`} />}
      {photo && <FeedPhoto src={photo} alt={post.body ?? `Photo${post.hole ? ` from hole ${post.hole}` : ""}`} onOpen={() => onPhoto(photo, post.body ?? "Photo")} />}
      <div className="sf-actions">
        <button className={`sf-act like${liked ? " on" : ""}`} onClick={onLike} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"}>
          {liked ? Ic.heartOn : Ic.heart}
          <span>{likeCount || ""}</span>
        </button>
        <button className="sf-act" onClick={onComments} aria-label={`Comments (${comments.length})`}>
          {Ic.comment}
          <span>{comments.length || ""}</span>
        </button>
        <button className="sf-act share" onClick={share} aria-label="Share">
          {Ic.share}
        </button>
      </div>
      {last && (
        <button className="sf-peek" onClick={onComments}>
          {comments.length > 1 && <span className="sf-peek-all">View all {comments.length} comments</span>}
          <span className="sf-peek-line">
            <strong>{last.author_name}</strong> {last.body}
          </span>
        </button>
      )}
    </article>
  );
}

/** A photo in the feed: cropped to between 4:5 and 1.91:1 like Instagram; a tap shows all of it. */
function FeedPhoto({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const shape = ratio ? Math.max(0.8, Math.min(1.91, ratio)) : 4 / 3;
  return (
    <button className="sf-media photo" onClick={onOpen} aria-label="Open the photo" style={{ aspectRatio: String(shape) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" onLoad={(e) => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || null)} />
    </button>
  );
}

/** A clip in the feed: plays muted while on screen (only the trimmed part); a tap opens it full screen with sound. */
function FeedVideo({ post, onOpen, shareName }: { post: PostRow; onOpen: () => void; shareName: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  // The broadcast version (TV graphics, replay) once it's made; until then the clip itself
  const bc = post.broadcast_status === "done" && post.broadcast_path ? post.broadcast_path : null;
  const tIn = bc ? 0 : post.trim_in != null ? Number(post.trim_in) : 0;
  const tOut = bc ? null : post.trim_out != null ? Number(post.trim_out) : null;
  const path = bc ?? post.media_path!;
  const poster = path.startsWith("http") ? undefined : (mediaUrl(`${path}.jpg`) ?? undefined);
  const src = bc ? mediaUrl(bc) : clipUrl(post);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.intersectionRatio >= 0.6) {
          v.play().catch(() => {});
          // On screen for a moment: get the file ready, so Share is instant
          soon = setTimeout(() => prefetchClip(post, shareName), 1500);
        } else {
          v.pause();
          if (soon) clearTimeout(soon);
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(v);
    // Loop inside the trimmed part
    const tick = () => {
      if (tOut != null && v.currentTime >= tOut) v.currentTime = tIn;
    };
    const ended = () => {
      v.currentTime = tIn;
      v.play().catch(() => {});
    };
    v.addEventListener("timeupdate", tick);
    v.addEventListener("ended", ended);
    return () => {
      io.disconnect();
      if (soon) clearTimeout(soon);
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("ended", ended);
    };
  }, [tIn, tOut, post, shareName]);

  const shape = ratio ? Math.max(0.8, Math.min(16 / 9, ratio)) : 0.8;
  return (
    <button className="sf-media video" onClick={onOpen} aria-label="Play full screen with sound" style={{ aspectRatio: String(shape) }}>
      <video
        ref={ref}
        src={src ?? undefined}
        poster={poster}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
        }}
      />
      <span className="sf-sound" aria-hidden="true">
        {Ic.muted}
      </span>
    </button>
  );
}

const PIECE_LABEL: Record<AiPieceRow["kind"], string> = { bulletin: "Live bulletin", preview: "Preview", report: "Match report", tournament: "Tournament review" };

function PieceCard({ piece, state, say }: { piece: AiPieceRow; state: TournamentState; say: (m: string) => void }) {
  const { href } = useT();
  const round = state.rounds.find((r) => r.id === piece.round_id);
  const short = piece.kind === "bulletin";
  const paras = cleanBody(piece.body).split(/\n\s*\n/).filter(Boolean);
  const readHref = round ? href(`/rounds/${round.number}`) : href("/");
  function share() {
    const url = `${window.location.origin}${short ? href(`/feed#p-${piece.id}`) : readHref}`;
    shareLink(url, cleanTitle(piece.title ?? PIECE_LABEL[piece.kind]), state.tournament.name, say);
  }
  return (
    <article className={`sf-card piece ${piece.kind}`} id={`p-${piece.id}`}>
      <Head name={PIECE_LABEL[piece.kind]} who="writer" at={piece.published_at ?? piece.created_at} place={round ? `Round ${round.number}` : ""} logo={mediaUrl(state.tournament.logo_path)} />
      {piece.title && <h3 className="sf-piece-title">{cleanTitle(piece.title)}</h3>}
      <div className="sf-piece-body">{short ? <Paras text={piece.body} /> : <Paras text={paras.slice(0, 1).join("\n\n")} />}</div>
      <div className="sf-actions">
        {!short && (
          <Link className="sf-act read" href={readHref}>
            Read the {piece.kind === "preview" ? "preview" : piece.kind === "report" ? "report" : "review"}
          </Link>
        )}
        <button className="sf-act share" onClick={share} aria-label="Share">
          {Ic.share}
        </button>
      </div>
    </article>
  );
}

function NoteCard({ c, onMenu }: { c: CommentRow; onMenu: () => void }) {
  const { state } = useT();
  return (
    <article className="sf-card" id={`p-${c.id}`}>
      <Head name={c.author_name} who={c.author_player_id ? "player" : "fan"} at={c.created_at} place={state ? where(state, c.round_id, null) : ""} onMenu={onMenu} />
      <p className={`sf-text${c.body.length < 90 ? " big" : ""}`}>{c.body}</p>
    </article>
  );
}

function shareLink(url: string, text: string, title: string, say: (m: string) => void) {
  if (navigator.share) {
    navigator.share({ title, text, url }).catch(() => {});
    return;
  }
  navigator.clipboard
    ?.writeText(url)
    .then(() => say("Link copied. Paste it anywhere."))
    .catch(() => say(url));
}

// ------------------------------------------------------------ the live score, pinned to the top

/** While a round is on: the score of every match (or the top five), one tap from the full live card */
function LiveNow() {
  const { state, summary, href } = useT();
  if (!state || !summary) return null;
  const round = state.rounds.find((r) => r.status === "live");
  if (!round) return null;
  const board = roundBoard(state, summary, round);
  const rows =
    board.kind === "match"
      ? board.matches.map((m) => ({ k: m.gameId, left: m.sides.map((sd) => sd.name).join(" v "), right: m.started ? `${m.big}${m.small ? ` · ${m.small}` : ""}` : "Not started" }))
      : board.field.slice(0, 5).map((r) => ({ k: r.sideId, left: r.thru ? `${r.pos} ${r.name}` : r.name, right: r.thru ? `${r.score} · thru ${r.thru}` : "Not started" }));
  return (
    <Link className="sf-live" href={href("/live")} aria-label="Live now: see the full live card">
      <span className="sf-live-h">
        <span className="dot" aria-hidden /> Live now · R{round.number} {round.course_name}
      </span>
      {rows.slice(0, 5).map((r) => (
        <span className="sf-live-row" key={r.k}>
          <span>{r.left}</span>
          <b>{r.right}</b>
        </span>
      ))}
      <span className="sf-live-more">See the live card ›</span>
    </Link>
  );
}

// ------------------------------------------------------------ writing a post

function Composer({ roundId, onJoin, say }: { roundId?: string; onJoin: () => void; say: (m: string) => void }) {
  const { state, session, crew, api, refresh, href, slug } = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const live = state?.rounds.find((r) => r.id === roundId) ?? state?.rounds.find((r) => r.status === "live") ?? null;

  if (!session)
    return (
      <button className="sf-compose ask" onClick={onJoin}>
        <span className="sf-av ghost" aria-hidden="true">
          {Ic.pen}
        </span>
        <span className="sf-ask">
          <span className="sf-ask-q">What&apos;s happening?</span>
          <span className="sf-ask-sub">Join to share photos and comment</span>
        </span>
      </button>
    );

  function picked(f: File | undefined) {
    if (!f) return;
    if (f.type.startsWith("video") || /\.(mov|mp4|m4v)$/i.test(f.name)) {
      // Videos go through the clip screen: trim, who, what shot
      setPendingClip(f);
      router.push(href(`/record?clip=1&from=feed${live ? `&round=${live.number}` : ""}`));
      return;
    }
    setPhoto(f);
  }

  // Fans share photos (with a caption); players can also post notes and clips
  const fan = !!session.fanId;
  const ready = fan ? !!photo : !!(text.trim() || photo);

  async function post() {
    if (busy || !ready) return;
    setBusy(true);
    try {
      let mediaPath: string | null = null;
      if (photo) {
        const up = await api("/api/upload-url", { filename: photo.name || "photo.jpg", contentType: photo.type || "image/jpeg" });
        if (!up.ok) throw new Error(String(up.j.error ?? "Couldn't start the upload"));
        const fd = new FormData();
        fd.append("cacheControl", "3600");
        fd.append("", photo);
        const put = await fetch(String(up.j.signedUrl), { method: "PUT", body: fd, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "false" } });
        if (!put.ok) throw new Error("The photo didn't upload. Try again.");
        mediaPath = String(up.j.path);
      }
      const hole = crew && live?.status === "live" ? currentHole(slug, live.id) : null;
      const r = await api("/api/posts", {
        body: text,
        kind: photo ? "photo" : "note",
        mediaPath,
        roundId: crew ? (live?.id ?? null) : null,
        hole,
      });
      if (!r.ok) throw new Error(String(r.j.error ?? "That didn't post. Try again."));
      setText("");
      setPhoto(null);
      await refresh();
      say("Posted");
    } catch (e) {
      say(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "No signal. Your post is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  const who: Who = session.fanId ? "fan" : session.playerId ? "player" : "crew";
  if (fan && !photo)
    return (
      <div className="sf-compose fan">
        <Avatar name={session.name} who={who} />
        <label className="btn sf-share-photo">
          {Ic.photo}
          <span>Share a photo</span>
          <input type="file" accept="image/*" hidden onChange={(e) => (picked(e.target.files?.[0]), (e.target.value = ""))} />
        </label>
      </div>
    );
  return (
    <div className="sf-compose">
      <Avatar name={session.name} who={who} />
      <div className="sf-compose-main">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={fan ? "Add a caption (optional)" : "What's happening?"}
          maxLength={crew ? 2000 : 500}
          rows={text.length > 60 ? 3 : 1}
          aria-label={fan ? "Caption" : "What's happening?"}
        />
        {preview && (
          <div className="sf-compose-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your photo" />
            <button onClick={() => setPhoto(null)} aria-label="Remove the photo">
              {Ic.close}
            </button>
          </div>
        )}
        <div className="sf-compose-foot">
          {crew && (
            <label className="sf-tool">
              {Ic.photo}
              <span>Photo or video</span>
              <input type="file" accept={state?.tournament.video_enabled === false ? "image/*" : "image/*,video/*"} hidden onChange={(e) => (picked(e.target.files?.[0]), (e.target.value = ""))} />
            </label>
          )}
          <button className="btn sf-post" disabled={busy || !ready} onClick={post}>
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ sheets

function CommentSheet({ post, onClose, onJoin, onMenu, say }: { post: PostRow; onClose: () => void; onJoin: () => void; onMenu: (c: CommentRow) => void; say: (m: string) => void }) {
  const { state, session, api, refresh } = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<CommentRow[]>([]);
  const list = useMemo(() => {
    const fromState = (state?.comments ?? []).filter((c) => c.post_id === post.id && !c.hidden);
    const ids = new Set(fromState.map((c) => c.id));
    return [...fromState, ...sent.filter((c) => !ids.has(c.id))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [state, post.id, sent]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [list.length]);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api("/api/comments", { postId: post.id, body: text });
    setBusy(false);
    if (!r.ok) return say(String(r.j.error ?? "That didn't send. Try again."));
    setText("");
    if (r.j.comment) setSent((s) => [...s, r.j.comment as CommentRow]);
    refresh();
  }

  return (
    <Sheet label={list.length ? `Comments (${list.length})` : "Comments"} onClose={onClose} tall>
      <div className="sf-comments">
        {list.length === 0 && <p className="sf-empty">No comments yet. Say something.</p>}
        {list.map((c) => (
          <div key={c.id} className="sf-comment">
            <Avatar name={c.author_name} who={whoOf(c)} />
            <div className="sf-comment-main">
              <div className="sf-name">
                <strong>{c.author_name}</strong>
                {LABEL[whoOf(c)] && <span className={`sf-label ${whoOf(c)}`}>{LABEL[whoOf(c)]}</span>}
                <span className="sf-meta">{timeAgo(c.created_at)}</span>
              </div>
              <p>{c.body}</p>
            </div>
            <button className="sf-more" onClick={() => onMenu(c)} aria-label="More options">
              {Ic.more}
            </button>
          </div>
        ))}
        <div ref={end} />
      </div>
      {session ? (
        <div className="sf-reply">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Comment as ${session.name}`} maxLength={500} rows={text.length > 40 ? 3 : 1} aria-label="Your comment" />
          <button className="btn" disabled={busy || !text.trim()} onClick={send}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      ) : (
        <div className="sf-reply">
          <button className="btn block" onClick={onJoin}>
            Join to comment
          </button>
        </div>
      )}
    </Sheet>
  );
}

function MenuSheet({
  table,
  item,
  mine,
  organiser,
  onClose,
  onReport,
  onDelete,
  onHide,
}: {
  table: "posts" | "comments";
  item: PostRow | CommentRow;
  mine: boolean;
  organiser: boolean;
  onClose: () => void;
  onReport: () => void;
  onDelete: () => void;
  onHide: () => void;
}) {
  const [confirm, setConfirm] = useState<"report" | "delete" | null>(null);
  const what = table === "posts" ? "post" : "comment";
  return (
    <Sheet label={confirm === "report" ? `Report this ${what}?` : confirm === "delete" ? `Delete your ${what}?` : `This ${what}`} onClose={onClose}>
      <div className="sf-menu">
        {confirm === "report" ? (
          <>
            <p>The organiser will take a look. It&apos;s hidden for everyone once three people report it.</p>
            <button className="btn danger block" onClick={onReport}>
              Report it
            </button>
            <button className="btn secondary block" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </>
        ) : confirm === "delete" ? (
          <>
            <p>&ldquo;{(item.body ?? "").slice(0, 120)}&rdquo; will be removed for good.</p>
            <button className="btn danger block" onClick={onDelete}>
              Delete it
            </button>
            <button className="btn secondary block" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {mine && (
              <button className="btn secondary block" onClick={() => setConfirm("delete")}>
                Delete my {what}
              </button>
            )}
            {organiser && !mine && (
              <button className="btn secondary block" onClick={onHide}>
                Hide it from everyone
              </button>
            )}
            {!mine && (
              <button className="btn secondary block" onClick={() => setConfirm("report")}>
                Report it
              </button>
            )}
            <button className="btn secondary block" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The first time a follower comments or shares a photo: their name and how they know the group, once (remembered on
 * this phone). An email is optional: confirmed with a code, it works on any phone and gets them the trip film.
 */
function JoinSheet({ why, onClose, say }: { why: string; onClose: () => void; say: (m: string) => void }) {
  const { state, api, reloadSession } = useT();
  const [name, setName] = useState("");
  const [how, setHow] = useState("");
  const [email, setEmail] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [over16, setOver16] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const hp = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!over16) return setErr("Tick the box to say you're 16 or over");
    setBusy(true);
    const r = await api("/api/fans", { action: "profile", name, how, email: email.trim(), marketing, over16, website: hp.current?.value ?? "" });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
    await reloadSession();
    if (r.j.confirm) return setCodeFor(email.trim());
    onClose();
    say(`You're in, ${name.split(" ")[0]}`);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "code", email: codeFor, code }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setErr(String(j.error ?? "That code didn't work."));
    await reloadSession();
    onClose();
    say("Your email's confirmed");
  }

  const tname = state?.tournament.name ?? "this tournament";
  if (codeFor)
    return (
      <Sheet label="Confirm your email" onClose={onClose}>
        <form className="sf-join" onSubmit={confirm}>
          <p className="sf-join-big">You&apos;re in. One more thing:</p>
          <p>
            We&apos;ve emailed a code to <strong>{codeFor}</strong>. Type it here to comment from any phone and get the trip film. Or do it later from the email.
          </p>
          <label className="sf-field">
            <span>The code from the email</span>
            <input className="si-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
          </label>
          {err && <p className="error">{err}</p>}
          <button className="btn block" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Confirm my email"}
          </button>
          <button type="button" className="btn secondary block" onClick={onClose}>
            Later
          </button>
        </form>
      </Sheet>
    );

  return (
    <Sheet label="Before you comment" onClose={onClose}>
      <form className="sf-join" onSubmit={submit}>
        <p className="sf-join-lede">
          {why === "comment" ? "Before your first comment" : "Before your first photo"} on {tname}, tell the players who you are. We&apos;ll remember it on this phone.
        </p>
        <label className="sf-field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required />
        </label>
        <label className="sf-field">
          <span>How do you know the group?</span>
          <input value={how} onChange={(e) => setHow(e.target.value)} maxLength={60} placeholder="For example, Neil's brother" />
        </label>
        <label className="sf-field">
          <span>Your email (optional)</span>
          <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" />
          <small>Comment from any phone, and get the trip film.</small>
        </label>
        {email.trim() && (
          <button type="button" className="cd-film-only" role="switch" aria-checked={marketing} onClick={() => setMarketing((v) => !v)}>
            <span className="box" aria-hidden="true">
              {marketing ? "✓" : ""}
            </span>
            <span>{MARKETING_WORDING}</span>
          </button>
        )}
        <input ref={hp} name="website" tabIndex={-1} autoComplete="off" className="sf-hp" aria-hidden="true" />
        <button type="button" className="cd-film-only" role="switch" aria-checked={over16} onClick={() => setOver16((v) => !v)}>
          <span className="box" aria-hidden="true">
            {over16 ? "✓" : ""}
          </span>
          <span>
            <strong>I&apos;m 16 or over</strong>
          </span>
        </button>
        {err && <p className="error">{err}</p>}
        <button className="btn block sf-join-go" disabled={busy}>
          {busy ? "Saving…" : "Carry on"}
        </button>
        <p className="small muted" style={{ margin: 0 }}>
          The players will see you&apos;re following. By continuing you agree to the <Link href="/privacy">privacy policy</Link>.
        </p>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------ icons

const svg = (d: React.ReactNode, fill = "none") => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill={fill} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const HEART = "M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z";
const Ic = {
  heart: svg(<path d={HEART} />),
  heartOn: svg(<path d={HEART} />, "currentColor"),
  comment: svg(<path d="M20.5 11.5a8 8 0 0 1-11.8 7L3.5 20l1.5-4.6A8 8 0 1 1 20.5 11.5z" />),
  share: svg(
    <>
      <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </>,
  ),
  more: svg(
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>,
  ),
  muted: svg(
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      <path d="M16.5 9.5l5 5m0-5l-5 5" />
    </>,
  ),
  play: svg(<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />),
  photo: svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="10.5" r="1.8" />
      <path d="M21 16l-5.5-5.5L6 19" />
    </>,
  ),
  pen: svg(<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />),
  news: svg(
    <>
      <path d="M5 4h11v15a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" />
      <path d="M16 8h3v11a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3" />
    </>,
  ),
  close: svg(<path d="M6 6l12 12M18 6L6 18" />),
};
