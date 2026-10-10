"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "./Providers";
import { MOMENTS } from "@/lib/courseCards";
import { flushPosts, queuePost } from "@/lib/postQueue";
import type { PlayerRow } from "@/lib/types";

const AUTO_SECONDS = 6;

/**
 * Between holes: what the scorecard won't show. Who (the group only) and a few big moments; a clip or a note.
 * Untouched, it moves on by itself after a few seconds, so it never costs a tap.
 */
export function HoleMoments({
  roundId,
  roundNumber,
  hole,
  players,
  nextLabel,
  onContinue,
  onLeave,
}: {
  roundId: string;
  roundNumber: number;
  hole: number;
  players: PlayerRow[];
  nextLabel: string;
  onContinue: () => void;
  /** Leaving for the camera or a note: move the scorecard on first, so it's ready when they're back */
  onLeave: () => void;
}) {
  const { slug, href } = useT();
  const [who, setWho] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    if (picked.length) {
      const names = who.map((id) => players.find((p) => p.id === id)?.name).filter(Boolean).join(" & ");
      const labels = MOMENTS.filter((m) => picked.includes(m.tag)).map((m) => m.label.toLowerCase());
      const text = labels.join(", ");
      queuePost(slug, {
        roundId,
        hole,
        kind: "note",
        body: names ? `${names}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1),
        tags: picked.slice(0, 5),
        playerIds: who,
      });
      flushPosts(slug);
    }
    onContinue();
  };

  // Nothing to add? It moves on by itself
  useEffect(() => {
    if (touched) return;
    const t = setTimeout(finish, AUTO_SECONDS * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => {
    setTouched(true);
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  return (
    <div className="moments" role="dialog" aria-label={`Hole ${hole}: anything the card won't show?`} onPointerDown={() => setTouched(true)}>
      <h2>
        Hole {hole} done. <span>Anything the card won&apos;t show?</span>
      </h2>
      {players.length > 0 && (
        <div className="mo-who" style={{ gridTemplateColumns: `repeat(${Math.min(players.length, 4)}, 1fr)` }}>
          {players.map((p) => (
            <button key={p.id} className="mo-tile who" aria-pressed={who.includes(p.id)} onClick={() => toggle(who, setWho, p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="mo-grid">
        {MOMENTS.map((m) => (
          <button key={m.tag} className="mo-tile" aria-pressed={picked.includes(m.tag)} onClick={() => toggle(picked, setPicked, m.tag)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="mo-row">
        <Link className="mo-tile mo-act" href={href(`/record?round=${roundNumber}&hole=${hole}`)} onClick={() => (finishQuietly(), onLeave())}>
          <span className="dot" aria-hidden="true" /> Record a clip
        </Link>
        <Link className="mo-tile mo-act" href={href(`/post?round=${roundNumber}&hole=${hole}&from=course`)} onClick={() => (finishQuietly(), onLeave())}>
          Write a note
        </Link>
      </div>
      <button className={`btn block mo-next${touched ? "" : " counting"}`} onClick={finish} style={{ ["--auto" as string]: `${AUTO_SECONDS}s` }}>
        {picked.length ? `Save, ${nextLabel.charAt(0).toLowerCase()}${nextLabel.slice(1)}` : nextLabel}
      </button>
    </div>
  );

  /** Leaving for a clip or note: keep any moments picked, without moving the page on twice. */
  function finishQuietly() {
    if (done.current) return;
    done.current = true;
    if (!picked.length) return;
    const names = who.map((id) => players.find((p) => p.id === id)?.name).filter(Boolean).join(" & ");
    const text = MOMENTS.filter((m) => picked.includes(m.tag)).map((m) => m.label.toLowerCase()).join(", ");
    queuePost(slug, { roundId, hole, kind: "note", body: names ? `${names}: ${text}` : text, tags: picked.slice(0, 5), playerIds: who });
    flushPosts(slug);
  }
}
