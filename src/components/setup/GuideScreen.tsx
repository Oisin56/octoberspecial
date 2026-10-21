"use client";

import { useState } from "react";
import { useT } from "@/components/Providers";
import type { CourseGuide, RoundRow, SetupJob } from "@/lib/types";
import { Screen } from "./Screens";

/**
 * The course guide: what the AI writer knows about the course, hole by hole. Found on the web once and kept in
 * the course library for every later tournament there; the organiser can search again, or write and correct it.
 * Saves when you leave each box.
 */

const empty: CourseGuide = { overview: "", signature: "", holes: {} };

export const guideHoles = (g: CourseGuide | null | undefined) => Object.keys(g?.holes ?? {}).length;

/** One line on where the guide stands, for the round's list. */
export function guideStatus(round: RoundRow, jobs: SetupJob[]): string {
  const g = round.course_guide;
  const n = guideHoles(g);
  if (n) return `Notes on ${n} of ${(round.all_holes ?? round.holes).length} holes`;
  if (g?.overview) return "An overview, no hole-by-hole notes";
  if (jobs.some((j) => j.kind === "guide" && j.roundId === round.id && j.status === "todo")) return "Still reading up on the course";
  return "Nothing found yet";
}

export function GuideScreen({ round, onSaved }: { round: RoundRow; onSaved: () => Promise<void> | void }) {
  const { api } = useT();
  const [g, setG] = useState<CourseGuide>(round.course_guide ?? empty);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [found, setFound] = useState<{ guide: CourseGuide | null; result: string; sources: string[] } | null>(null);
  const card = round.all_holes ?? round.holes;

  async function save(next: CourseGuide, by: "organiser" | "research" = "organiser", sources: string[] = [], what = "Saved") {
    setErr(null);
    const r = await api("/api/admin", { action: "saveGuide", roundId: round.id, guide: next, by, sources });
    if (!r.ok) return setErr(String(r.j.error ?? "Couldn't save that. Check the signal and try again."));
    setSavedAt(what);
    await onSaved();
  }
  const changed = (a: CourseGuide) => JSON.stringify(a) !== JSON.stringify(round.course_guide ?? empty);
  const blur = () => changed(g) && save(g);

  /** Search the web again: the club's own pages first, every note checked against the card */
  async function search() {
    setErr(null);
    setFound(null);
    setSavedAt(null);
    setStep("Searching for the course's hole-by-hole pages…");
    let work: Record<string, unknown> | null = null;
    for (let n = 0; n < 8; n++) {
      const r = await api("/api/admin", { action: "guideStep", roundId: round.id, work });
      if (!r.ok) {
        setStep(null);
        return setErr(String(r.j.error ?? "Couldn't search just now. Try again."));
      }
      work = r.j.work as Record<string, unknown>;
      const next = ((work.sources as { url: string; status: string }[]) ?? []).find((x) => x.status === "todo");
      if (work.stage === "done") {
        setStep(null);
        const guide = (r.j.guide as CourseGuide | null) ?? null;
        const sources = (work.from as string[]) ?? [];
        // Nothing written yet: use it straight away. Otherwise ask before replacing what's there
        if (guide && !guideHoles(g) && !g.overview) {
          setG(guide);
          await save(guide, "research", sources, String(work.result));
          return;
        }
        return setFound({ guide, result: String(work.result ?? ""), sources });
      }
      if (next) setStep(`Reading ${host(next.url)}…`);
    }
    setStep(null);
    setErr("That took too long. Try again.");
  }

  const n = guideHoles(g);
  return (
    <Screen q="Course guide" label={round.course_name} hint="What the AI knows about the course, for previews, bulletins, reports and the film. Kept for every later tournament here.">
      {step ? (
        <p className="notice" aria-live="polite">
          {step}
        </p>
      ) : n || g.overview ? (
        <p className="small muted">
          {n ? `Notes on ${n} of ${card.length} holes.` : "An overview, but no hole-by-hole notes."} Change anything below; it saves when you leave the box.
        </p>
      ) : (
        <p className="notice">Nothing found for this course yet. Search again, or write a line or two yourself below.</p>
      )}
      {savedAt && !step && <p className="su-saved-line">✓ {savedAt}</p>}
      {found && (
        <div className="panel stack">
          {found.guide ? (
            <>
              <p>
                {found.result}. Use these in place of the notes below?
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const next = { overview: found.guide!.overview || g.overview, signature: found.guide!.signature || g.signature, holes: found.guide!.holes };
                    setG(next);
                    setFound(null);
                    await save(next, "research", found.sources, "Saved the new notes");
                  }}
                >
                  Use the new notes
                </button>
                <button type="button" className="btn secondary" onClick={() => setFound(null)}>
                  Keep what&apos;s here
                </button>
              </div>
            </>
          ) : (
            <p>Nothing reliable found this time: no page described the holes in a way that matched your card.</p>
          )}
        </div>
      )}
      <button type="button" className="btn secondary block" disabled={!!step} onClick={search}>
        {n || g.overview ? "Search the web again" : "Try again"}
      </button>
      {err && <p className="error">{err}</p>}
      <div className="stack guide-editor">
        <label className="field">
          <span className="lbl">About the course</span>
          <textarea value={g.overview} onChange={(e) => setG({ ...g, overview: e.target.value })} onBlur={blur} style={{ minHeight: 90 }} placeholder="e.g. Parkland, tree-lined, opened in 1893; small, quick greens" />
        </label>
        <label className="field">
          <span className="lbl">The holes people talk about</span>
          <textarea value={g.signature} onChange={(e) => setG({ ...g, signature: e.target.value })} onBlur={blur} style={{ minHeight: 60 }} />
        </label>
        <div className="guide-holes">
          {card.map((h) => {
            const k = String(h.number);
            return (
              <label key={k} className="field">
                <span className="lbl">
                  Hole {k}, par {h.par}
                </span>
                <textarea
                  value={g.holes[k] ?? ""}
                  onChange={(e) => {
                    const holes = { ...g.holes };
                    if (e.target.value) holes[k] = e.target.value;
                    else delete holes[k];
                    setG({ ...g, holes });
                  }}
                  onBlur={blur}
                  placeholder="Leave it blank if you don't know"
                  style={{ minHeight: 70 }}
                />
              </label>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}

function host(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "the page";
  }
}
