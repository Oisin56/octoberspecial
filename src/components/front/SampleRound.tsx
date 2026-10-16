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
import { ReelFeed, feedItems } from "@/components/ReelFeed";
import { SocialFeed } from "@/components/SocialFeed";
import { toEntries, toTournamentCfg, type TournamentState } from "@/lib/types";
import { tournamentSummary } from "@/lib/engine";
import { roundBoard } from "@/lib/live";
import {
  SAMPLE_GEO,
  SAMPLE_NOTE,
  SAMPLE_POST_EVENT,
  SAMPLE_SLUG,
  YOU,
  sampleClipPath,
  samplePost,
  sampleReactions,
  sampleSpot,
  sampleState,
} from "@/lib/sample";

export type SampleStep = "play" | "record" | "highlight" | "feed";

export const STEP_HELP: Record<SampleStep, { title: string; body: string }> = {
  play: {
    title: "Score three holes",
    body: "Enter everyone's score with plus and minus. Tap GPS on the right for distances. After each hole, say what happened, or tap Clip.",
  },
  record: {
    title: "Film the shot",
    body: "On the course this opens your camera. Here's one we filmed earlier.",
  },
  highlight: {
    title: "The highlight",
    body: "Your clip, as everyone at home sees it. In a real round, a version with TV graphics follows a few minutes later.",
  },
  feed: {
    title: "What everyone at home saw",
    body: "The leaderboard, the clip, a bulletin written from your scores, and what people said.",
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
  const [recordHole, setRecordHole] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  const [clipPath, setClipPath] = useState("/home/clips/putt.webm");

  // A fresh round (and a fresh phone) on the way in, and on Start again
  useEffect(() => {
    clearLocal();
    const t = setTimeout(() => {
      setClipPath(sampleClipPath());
      setState(sampleState());
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
      let next = s;
      // No clip filmed: someone in the group filmed one
      if (!next.posts.some((p) => p.kind === "video")) {
        const p = samplePost(next, {
          kind: "video",
          hole: 2,
          body: "thirty feet on the 2nd",
          mediaPath: clipPath,
          playerIds: [next.players[1].id],
        });
        next = {
          ...next,
          posts: [
            {
              ...p,
              author_name: next.players[2].name,
              author_player_id: next.players[2].id,
            },
            ...next.posts,
          ],
        };
      }
      const cfg = toTournamentCfg(next);
      const summary = tournamentSummary(cfg, toEntries(next.entries));
      const field = roundBoard(next, summary, next.rounds[0]).field;
      const { comments, piece } = sampleReactions(next, field);
      return {
        ...next,
        comments: [
          ...comments,
          ...next.comments.filter((c) => !c.id.startsWith("sample-")),
        ],
        pieces: [piece],
      };
    });
    setStep("highlight");
  }, [patch, clipPath]);
  useEffect(() => {
    if (!go) return;
    const where = decodeURIComponent(go);
    const t = setTimeout(() => {
      if (where.startsWith("/record")) {
        const h = Number(
          new URLSearchParams(where.split("?")[1] ?? "").get("hole"),
        );
        setRecordHole(Number.isFinite(h) && h > 0 ? h : 1);
        setStep("record");
      } else if (where.startsWith("/live") || where === "/") {
        if (state && state.entries.length >= state.rounds[0].holes.length)
          finish();
      }
      router.replace(base.slice(0, -1), { scroll: false });
    }, 0);
    return () => clearTimeout(t);
  }, [go, base, router, state, finish]);

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
      refresh: async () => {},
      patch,
      demo: false,
      session: SESSION,
      crew: true,
      reloadSession: async () => {},
      sessionReady: true,
      href,
      api: async () => ({ ok: true, status: 200, j: {} }),
      sample: { geo: SAMPLE_GEO, spot: sampleSpot, note: SAMPLE_NOTE },
    };
  }, [state, patch, href]);

  if (!value || !state) return <div className="sr-loading" aria-busy="true" />;

  const keepClip = () => {
    patch((s) => ({
      ...s,
      posts: [
        samplePost(s, {
          kind: "video",
          hole: recordHole,
          body: "from thirty feet",
          mediaPath: clipPath,
        }),
        ...s.posts,
      ],
    }));
    setStep("play");
  };

  return (
    <SampleProviders value={value}>
      <ThemeRoot>
        <div className={`sr-root${embed ? " is-embed" : ""}`}>
          {/* The highlight is full screen, as in the app: its own button leads on */}
          {step !== "highlight" && (
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
                  href="/preview"
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
            <div className="sr-record" role="dialog" aria-label="Your clip">
              <video
                src={clipPath}
                poster="/home/clips/putt.jpg"
                autoPlay
                muted
                playsInline
                loop
                className="sr-record-video"
              />
              <span className="sr-rec">Hole {recordHole}</span>
              <div className="sr-record-actions">
                <button type="button" className="btn block" onClick={keepClip}>
                  Post it
                </button>
                <button
                  type="button"
                  className="btn secondary block"
                  onClick={() => setStep("play")}
                >
                  Back to the scorecard
                </button>
              </div>
            </div>
          )}

          {step === "highlight" && (
            <div className="sr-highlight">
              <ReelFeed
                items={feedItems(state, null)}
                state={state}
                tournamentName={state.tournament.name}
                backHref={base.slice(0, -1)}
                api={value.api}
                refresh={() => {}}
              />
              <button
                type="button"
                className="btn sr-next"
                onClick={() => setStep("feed")}
              >
                See the feed
              </button>
            </div>
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
