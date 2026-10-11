"use client";

import { useRef, useState } from "react";
import { useSwipe } from "@/lib/useSwipe";
import { HoldToTalk } from "./HoldToTalk";
import Link from "next/link";
import { useT } from "./Providers";
import { MOMENTS } from "@/lib/courseCards";
import { flushPosts, queuePost } from "@/lib/postQueue";
import type { PlayerRow } from "@/lib/types";

/**
 * Between holes: what the scorecard won't show. Who (the group only) and a few big moments; a clip or a note.
 * Swipe on (or tap the big button) to the next hole; swipe back to the hole just played.
 */
export function HoleMoments({
  roundId,
  roundNumber,
  hole,
  players,
  nextLabel,
  onContinue,
  onBack,
  onLeave,
}: {
  roundId: string;
  roundNumber: number;
  hole: number;
  players: PlayerRow[];
  nextLabel: string;
  onContinue: () => void;
  /** Swipe back: the hole just played */
  onBack: () => void;
  /** Leaving for the camera or a note: move the scorecard on first, so it's ready when they're back */
  onLeave: () => void;
}) {
  const { slug, href } = useT();
  const [who, setWho] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [said, setSaid] = useState("");
  const done = useRef(false);
  const swipe = useSwipe({ onLeft: () => finish(), onRight: () => onBack() });

  /** Post what was picked or said (if anything), once. */
  const save = () => {
    if (done.current) return;
    done.current = true;
    if (!picked.length && !said.trim()) return;
    const names = who.map((id) => players.find((p) => p.id === id)?.name).filter(Boolean).join(" & ");
    const labels = MOMENTS.filter((m) => picked.includes(m.tag)).map((m) => m.label.toLowerCase()).join(", ");
    const head = labels ? (names ? `${names}: ${labels}` : labels.charAt(0).toUpperCase() + labels.slice(1)) : names ? `${names}:` : "";
    const body = [head, said.trim()].filter(Boolean).join(labels ? ". " : " ");
    queuePost(slug, { roundId, hole, kind: "note", body, tags: picked.slice(0, 5), playerIds: who });
    flushPosts(slug);
  };
  const finish = () => {
    save();
    onContinue();
  };

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  return (
    <div className="moments" role="dialog" aria-label={`Hole ${hole}: anything the card won't show?`} {...swipe}>
      <h2>
        Hole {hole}: <span>anything the card won&apos;t show?</span>
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
        <Link className="mo-tile mo-act" href={href(`/record?round=${roundNumber}&hole=${hole}`)} onClick={() => (save(), onLeave())}>
          <span className="dot" aria-hidden="true" /> Record a clip
        </Link>
        <HoldToTalk compact onText={(t) => setSaid((x) => (x ? `${x} ${t}` : t))} />
      </div>
      {said && (
        <div className="mo-said">
          <p>&ldquo;{said}&rdquo;</p>
          <button className="mo-clear" onClick={() => setSaid("")} aria-label="Remove what you said">
            Remove
          </button>
        </div>
      )}
      <button className="btn block mo-next" onClick={finish}>
        {picked.length || said ? `Save, ${nextLabel.charAt(0).toLowerCase()}${nextLabel.slice(1)}` : nextLabel} ›
        <small>or swipe</small>
      </button>
    </div>
  );

}
