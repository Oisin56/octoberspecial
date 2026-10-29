"use client";

import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  SampleProviders,
  type ClientSession,
  type TournamentCtx,
} from "@/components/Providers";
import { ThemeRoot } from "@/components/ThemeRoot";
import { TabBar } from "@/components/TabBar";
import { GpsTab } from "@/components/GpsTab";
import ScoreScreen from "@/components/ScoreScreen";
import { SocialFeed } from "@/components/SocialFeed";
import { SampleFilm } from "./SampleFilm";
import { toEntries, toTournamentCfg, type TournamentState } from "@/lib/types";
import { tournamentSummary } from "@/lib/engine";
import { roundBoard } from "@/lib/live";
import {
  SAMPLE_CLIP_HOLE,
  SAMPLE_GEO,
  SAMPLE_LOCKED,
  SAMPLE_NOTE,
  SAMPLE_POST_EVENT,
  SAMPLE_SLUG,
  YOU,
  sampleClipPath,
  samplePost,
  sampleReactions,
  sampleSpot,
  sampleState,
  yourRoundDone,
} from "@/lib/sample";

export type SampleStep = "play" | "record" | "highlight" | "feed";

export const STEP_HELP: Record<SampleStep, { title: string; body: string }> = {
  play: {
    title: "Score three holes",
    body: "You're playing with Declan and Marcus, and their scores are already in. Enter yours with plus and minus. Tap GPS on the right for distances. When the scores are in, add detail if you like, or go on to the next hole.",
  },
  record: {
    title: "Film the shot",
    body: "On the course, Clip opens your camera. Marcus filmed Declan's putt on the 3rd.",
  },
  highlight: {
    title: "How it looks in the film",
    body: "Declan's putt with the film's graphics, commentary and music. The leaderboard in the corner comes from the scores you entered.",
  },
  feed: {
    title: "What everyone at home saw",
    body: "A bulletin written from your scores, the clip, and what people said. All of it as it happened.",
  },
};

const SESSION: ClientSession = { role: "player", name: "You", playerId: YOU };

/** Clear what a previous go left on this phone (the queues and the scorecard's place) */
function clearLocal() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.includes(SAMPLE_SLUG)) localStorage.removeItem(k);
      else if (/^(os_score_queue|mgs_shot|mgs_gps|mgs_post)/.test(k)) {
        const v = localStorage.getItem(k);
        if (v && v.includes(SAMPLE_SLUG)) {
          const kept = (JSON.parse(v) as { slug?: string }[]).filter(
            (x) => x?.slug !== SAMPLE_SLUG,
          );
          localStorage.setItem(k, JSON.stringify(kept));
        }
      }
    }
    for (const k of Object.keys(sessionStorage))
      if (k.includes(SAMPLE_SLUG) || k.startsWith("mgs-geo-"))
        sessionStorage.removeItem(k);
  } catch {}
}

/**
 * The front page's sample round: three holes on the app's real screens, then what everyone at home saw.
 * Nothing leaves the phone, and no camera, microphone or location permission is asked for.
 */
export function SampleRound({ onStep }: { onStep?: (s: SampleStep) => void }) {
  return (
    <SampleBoundary>
      <Suspense fallback={null}>
        <Inner onStep={onStep} />
      </Suspense>
    </SampleBoundary>
  );
}

function Inner({ onStep }: { onStep?: (s: SampleStep) => void }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const embed = sp.get("embed") === "1";
  const [state, setState] = useState<TournamentState | null>(null);
  const [step, setStep] = useState<SampleStep>("play");
  const [run, setRun] = useState(0);
  const [clipPath, setClipPath] = useState("/home/clips/putt.webm");

  // A fresh round (and a fresh phone) on the way in, and on Start again
  useEffect(() => {
    clearLocal();
    const t = setTimeout(() => {
      const clip = sampleClipPath();
      setClipPath(clip);
      setState(sampleState(clip));
      setStep("play");
    }, 0);
    return () => clearTimeout(t);
  }, [run]);

  useEffect(() => onStep?.(step), [step, onStep]);

  const patch = useCallback(
    (fn: (s: TournamentState) => TournamentState) =>
      setState((s) => (s ? fn(s) : s)),
    [],
  );

  // Notes from the voice button arrive as "posts"
  useEffect(() => {
    const on = (e: Event) => {
      const b = (e as CustomEvent).detail as {
        roundId?: string;
        hole?: number;
        kind?: string;
        body?: string;
        playerIds?: string[];
      };
      patch((s) => ({
        ...s,
        posts: [
          samplePost(s, {
            roundId: b.roundId,
            hole: b.hole,
            kind: "note",
            body: b.body,
            playerIds: b.playerIds,
          }),
          ...s.posts,
        ],
      }));
    };
    window.addEventListener(SAMPLE_POST_EVENT, on);
    return () => window.removeEventListener(SAMPLE_POST_EVENT, on);
  }, [patch]);

  // The app's own links (Clip, Record, the end of the round) come back here as ?go=<where>
  const base = `${path}?${embed ? "embed=1&" : ""}`;
  const href = useCallback(
    (p: string) => `${base}go=${encodeURIComponent(p)}`,
    [base],
  );
  const go = sp.get("go");
  const finish = useCallback(() => {
    patch((s) => {
      const cfg = toTournamentCfg(s);
      const summary = tournamentSummary(cfg, toEntries(s.entries));
      const field = roundBoard(s, summary, s.rounds[0]).field;
      const { comments, piece } = sampleReactions(s, field);
      // The bulletin is the newest thing in the feed: your notes from the round come just before it
      const before = new Date(Date.now() - 40e3).toISOString();
      return {
        ...s,
        posts: s.posts.map((p) =>
          p.kind === "note" && p.created_at > before
            ? { ...p, created_at: before }
            : p,
        ),
        comments: [
          ...comments,
          ...s.comments.filter((c) => !c.id.startsWith("sample-")),
        ],
        pieces: [piece],
      };
    });
    setStep("highlight");
  }, [patch]);
  useEffect(() => {
    if (!go) return;
    const where = decodeURIComponent(go);
    const t = setTimeout(() => {
      if (where.startsWith("/highlights")) {
        // The clip in the feed: the film again
        if (step === "feed") setStep("highlight");
      } else if (step === "feed") {
        // The feed's other links go to pages the sample doesn't have: stay put
      } else if (where.startsWith("/record")) {
        setStep("record");
      } else if (where.startsWith("/live") || where === "/") {
        // The end of the round (only once your score is in on every hole)
        if (state && yourRoundDone(state)) finish();
      }
      router.replace(base.slice(0, -1), { scroll: false });
    }, 0);
    return () => clearTimeout(t);
  }, [go, base, router, state, finish, step]);

  const value = useMemo<TournamentCtx | null>(() => {
    if (!state) return null;
    const cfg = toTournamentCfg(state);
    const summary = tournamentSummary(cfg, toEntries(state.entries));
    return {
      slug: SAMPLE_SLUG,
      state,
      cfg,
      summary,
      names: Object.fromEntries(state.players.map((p) => [p.id, p.name])),
      loading: false,
      error: null,
      gate: null,
      isPrivate: false,
      refresh: async () => {},
      patch,
      demo: false,
      session: SESSION,
      crew: true,
      reloadSession: async () => {},
      sessionReady: true,
      href,
      api: async () => ({ ok: true, status: 200, j: {} }),
      sample: {
        geo: SAMPLE_GEO,
        spot: sampleSpot,
        note: SAMPLE_NOTE,
        locked: SAMPLE_LOCKED,
        wind: "A little hurt",
      },
    };
  }, [state, patch, href]);

  if (!value || !state) return <div className="sr-loading" aria-busy="true" />;

  return (
    <SampleProviders value={value}>
      <ThemeRoot>
        <div className={`sr-root${embed ? " is-embed" : ""}`}>
          {(
            <div className="sr-bar" role="note">
              <span>
                <b>Sample round.</b> Nothing is saved.
              </span>
              <button
                type="button"
                className="sr-again"
                onClick={() => setRun((n) => n + 1)}
              >
                Start again
              </button>
              {!embed && (
                <Link
                  href="/"
                  className="sr-close"
                  aria-label="Back to the front page"
                >
                  Close
                </Link>
              )}
            </div>
          )}

          {(step === "play" || step === "record") && (
            <>
              <main className="wrap sr-main">
                <ScoreScreen key={run} />
              </main>
              <TabBar />
              <GpsTab />
            </>
          )}

          {step === "record" && (
            <div
              className="sr-cam"
              role="dialog"
              aria-label="Where your camera opens"
              onClick={() => setStep("play")}
            >
              <div className="sr-cam-card" onClick={(e) => e.stopPropagation()}>
                <h2>Your camera opens here</h2>
                <p>
                  On the course, Clip opens your phone&apos;s camera. Film the
                  shot, trim it if you like, and it&apos;s in the feed for
                  everyone at home.
                </p>
                <div className="sr-cam-clip">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/home/clips/putt.jpg" alt="" />
                  <p>
                    In this round, Marcus filmed Declan&apos;s putt on the{" "}
                    {SAMPLE_CLIP_HOLE === 3 ? "3rd" : `hole ${SAMPLE_CLIP_HOLE}`}.
                    You&apos;ll see it at the end.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn block big"
                  onClick={() => setStep("play")}
                >
                  Back to the scorecard
                </button>
              </div>
            </div>
          )}

          {step === "highlight" && (
            <SampleFilm
              state={state}
              clipPath={clipPath}
              onFeed={() => setStep("feed")}
            />
          )}

          {step === "feed" && (
            <main className="wrap sr-feed">
              <h1 className="sf-page-title">Feed</h1>
              <SocialFeed composer={false} />
              <button
                type="button"
                className="btn block sr-again-big"
                onClick={() => setRun((n) => n + 1)}
              >
                Play it again
              </button>
            </main>
          )}
        </div>
      </ThemeRoot>
    </SampleProviders>
  );
}

/** If anything in the sample breaks, the screen recording of a real round plays instead. */
class SampleBoundary extends Component<
  { children: React.ReactNode },
  { broken: boolean }
> {
  state = { broken: false };
  static getDerivedStateFromError() {
    return { broken: true };
  }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className="sr-fallback">
        <video
          src="/home/clips/walkthrough.mp4"
          poster="/home/play.jpg"
          controls
          playsInline
          muted
          autoPlay
          loop
        />
        <p>A real round, start to finish.</p>
      </div>
    );
  }
}
