"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/Providers";
import type { CourseGuide, RoundRow, SetupJob } from "@/lib/types";
import { libraryRef } from "@/lib/wizard";
import { Screen } from "./Screens";

/**
 * The course guide: what the AI writer knows about the course. It's found online in the background when the course
 * is picked and kept for every later tournament there; here the organiser can read it, correct it, write it, or
 * (when nothing was found) try again. Saves when you leave each box.
 */

const empty: CourseGuide = { overview: "", history: "", signature: "", holes: {} };

export const guideHoles = (g: CourseGuide | null | undefined) => Object.keys(g?.holes ?? {}).length;
const hasGuide = (g: CourseGuide | null | undefined) => !!g && (guideHoles(g) > 0 || !!g.overview || !!g.history || !!g.signature);

/** One line on where the guide stands, for the round's list. */
export function guideStatus(round: RoundRow, jobs: SetupJob[]): string {
  const g = round.course_guide;
  const n = guideHoles(g);
  if (n) return `Notes on ${n} of ${(round.all_holes ?? round.holes).length} holes`;
  if (hasGuide(g)) return "About the course, no hole-by-hole notes";
  if (jobs.some((j) => j.kind === "guide" && j.roundId === round.id && j.status === "todo")) return "Still reading up on it online";
  return "Nothing found online";
}

export function GuideScreen({ round, searching: initial, onSaved }: { round: RoundRow; searching: boolean; onSaved: () => Promise<void> | void }) {
  const { api } = useT();
  const [g, setG] = useState<CourseGuide>({ ...empty, ...(round.course_guide ?? {}) });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(initial && !hasGuide(round.course_guide));
  const card = round.all_holes ?? round.holes;
  const ref = libraryRef(round.course_slug);
  const reload = useRef(onSaved);
  useEffect(() => {
    reload.current = onSaved;
  }, [onSaved]);

  // Reading up on it in the background: look in now and then, and show it when it's in
  useEffect(() => {
    if (!searching) return;
    let stop = false;
    const look = async () => {
      const r = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status", ref }) })
        .then((x) => x.json())
        .catch(() => null);
      if (stop || !r || r.status === "researching") return;
      setSearching(false);
      if (r.found) {
        // Picked up by the rounds at this course: load it
        await api("/api/setup", {});
        await reload.current();
      }
    };
    const t = setInterval(look, 15_000);
    look();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [searching, ref, api]);

  async function save(next: CourseGuide) {
    setErr(null);
    const r = await api("/api/admin", { action: "saveGuide", roundId: round.id, guide: next, by: "organiser" });
    if (!r.ok) return setErr(String(r.j.error ?? "Couldn't save that. Check the signal and try again."));
    setSaved(true);
    await onSaved();
  }
  const blur = () => JSON.stringify(g) !== JSON.stringify({ ...empty, ...(round.course_guide ?? {}) }) && save(g);

  async function tryAgain() {
    setErr(null);
    const body = ref.startsWith("manual:") ? { action: "start", again: true, manual: { name: round.course_name, location: round.course_location, card: card.map((h) => ({ par: h.par })) } } : { action: "start", again: true, ref };
    const r = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!r?.ok) return setErr("Couldn't start the search. Check the signal and try again.");
    setSearching(true);
  }

  const n = guideHoles(g);
  const field = (k: "overview" | "history" | "signature", label: string, rows = 90, placeholder?: string) => (
    <label className="field">
      <span className="lbl">{label}</span>
      <textarea value={g[k] ?? ""} onChange={(e) => setG({ ...g, [k]: e.target.value })} onBlur={blur} style={{ minHeight: rows }} placeholder={placeholder} />
    </label>
  );
  return (
    <Screen q="Course guide" label={round.course_name} hint="What the AI knows about the course, for the previews, reports and the film. Kept for every later tournament here.">
      {searching ? (
        <p className="notice" aria-live="polite">
          Reading up on this course online. It can take a few minutes, and you don&apos;t need to stay on this page.
        </p>
      ) : !hasGuide(g) ? (
        <>
          <p className="notice">Couldn&apos;t find information about this course online. Try again, or write a line or two yourself below.</p>
          <button type="button" className="btn secondary block" onClick={tryAgain}>
            Try again
          </button>
        </>
      ) : (
        <p className="small muted">{n ? `Notes on ${n} of ${card.length} holes. ` : ""}Change anything below; it saves when you leave the box.</p>
      )}
      {saved && <p className="su-saved-line">✓ Saved</p>}
      {err && <p className="error">{err}</p>}
      <div className="stack guide-editor">
        {field("overview", "About the course", 90, "e.g. Parkland, tree-lined, small quick greens")}
        {field("history", "Its story", 80, "e.g. Founded in 1893; the course was laid out by …")}
        {field("signature", "The holes people talk about", 60)}
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
