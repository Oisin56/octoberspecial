"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/**
 * The front page's one moving moment: a TV-style leaderboard from a made-up tournament (the Atlantic Cup, invented
 * names). A birdie goes in, the board reshuffles and a caption slides up, a few times over, then it rests.
 * Phones set to reduce motion get the board standing still.
 */

type Row = { name: string; pts: number; thru: number };

const START: Row[] = [
  { name: "Shane", pts: 24, thru: 11 },
  { name: "Declan", pts: 22, thru: 11 },
  { name: "Marcus", pts: 21, thru: 11 },
  { name: "Ronan", pts: 17, thru: 11 },
];

/** What happens, in order: who scores, how many points, and the caption the graphic shows. */
const EVENTS: { name: string; add: number; caption: string; who: string }[] = [
  { name: "Declan", add: 3, who: "Declan", caption: "Birdie at the 12th. Takes the lead" },
  { name: "Shane", add: 2, who: "Shane", caption: "Par at the 12th. Back in front" },
  { name: "Marcus", add: 3, who: "Marcus", caption: "Birdie at the 12th. Up to third" },
  { name: "Ronan", add: 4, who: "Ronan", caption: "Eagle at the 12th. The shot of the day" },
];

const STEP_MS = 3400;

function order(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  return sorted.map((r) => {
    const above = sorted.filter((o) => o.pts > r.pts).length;
    const tied = sorted.filter((o) => o.pts === r.pts).length > 1;
    return { ...r, pos: `${tied ? "T" : ""}${above + 1}` };
  });
}

function stateAt(step: number) {
  const rows = START.map((r) => ({ ...r }));
  for (let i = 0; i < step; i++) {
    const e = EVENTS[i];
    const r = rows.find((x) => x.name === e.name)!;
    r.pts += e.add;
    r.thru = 12;
  }
  return rows;
}

export function BroadcastBoard() {
  // step 0 = before anything happens; step n = after event n
  const [step, setStep] = useState(0);
  const [still, setStill] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const t = setTimeout(() => {
        setStill(true);
        setStep(1);
      }, 0);
      return () => clearTimeout(t);
    }
    let visible = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = 0;
    const tick = () => {
      if (visible && !document.hidden) {
        current = current >= EVENTS.length ? 0 : current + 1;
        setStep(current);
      }
      // Rest a little longer on the full board before going round again
      timer = setTimeout(tick, current >= EVENTS.length ? STEP_MS * 2 : STEP_MS);
    };
    timer = setTimeout(tick, 1400);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.2 });
    if (box.current) io.observe(box.current);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, []);

  const rows = order(stateAt(step));
  const event = step > 0 ? EVENTS[step - 1] : null;
  const prev = order(stateAt(Math.max(0, step - 1)));

  return (
    <div className={`bx-board${still ? " is-still" : ""}`} ref={box} role="img" aria-label="A live leaderboard: Shane, Declan, Marcus and Ronan, with a birdie moving Declan into the lead">
      <div className="bx-board-head">
        <span className="bx-live">Live</span>
        <span className="bx-board-title">The Atlantic Cup</span>
        <span className="bx-board-round">Round 1, Birr</span>
      </div>
      <div className="bx-rows" aria-hidden>
        {START.map((s) => {
          const i = rows.findIndex((r) => r.name === s.name);
          const r = rows[i];
          const moved = event && event.name === s.name;
          const was = prev.find((p) => p.name === s.name);
          return (
            <div key={s.name} className={`bx-row${moved ? " is-hot" : ""}${i === 0 ? " is-lead" : ""}`} style={{ transform: `translateY(calc(var(--bx-row) * ${i}))` }}>
              <span className="bx-pos">{r.pos}</span>
              <span className="bx-name">
                {r.name}
                {moved && was && r.pts > was.pts && <i className="bx-plus">+{r.pts - was.pts}</i>}
              </span>
              <span className="bx-thru">{r.thru === 18 ? "F" : `Thru ${r.thru}`}</span>
              <span className="bx-pts" key={`${s.name}-${r.pts}`}>
                {r.pts}
              </span>
            </div>
          );
        })}
      </div>
      <div className="bx-board-foot" aria-hidden>
        <span>Stableford points</span>
        <span>12th hole, par 4</span>
      </div>
      <div className="bx-third" aria-hidden key={step}>
        {event ? (
          <>
            <b>{event.who}</b>
            <span>{event.caption}</span>
          </>
        ) : (
          <>
            <b>Round 1</b>
            <span>Four friends. One trophy. Live from Birr</span>
          </>
        )}
      </div>
    </div>
  );
}

const TICKER = [
  ["Leaderboard", "Shane 26 pts, Declan 25, Marcus 24, Ronan 21"],
  ["New clip", "Declan's chip at the 9th"],
  ["Match report", "Round 1 lands in everyone's inbox at 7pm"],
  ["Photos", "12 new from the 10th tee"],
  ["Weather at Birr", "14 degrees, light westerly"],
  ["Tomorrow", "Round 2 tees off at 9:30"],
];

/** The score ticker along the bottom of the screen, as on TV. */
export function Ticker() {
  const items = TICKER.map(([k, v]) => (
    <span className="bx-tick" key={k}>
      <b>{k}</b> {v}
    </span>
  ));
  return (
    <div className="bx-ticker" aria-hidden>
      <span className="bx-ticker-tag">Live</span>
      <div className="bx-ticker-run">
        <div className="bx-ticker-track">
          {items}
          {items}
        </div>
      </div>
    </div>
  );
}

/** Adds "is-in" to its box the first time it scrolls into view (the film's caption slides up then). */
export function InView({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setIn(true);
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${className}${inView ? " is-in" : ""}`}>
      {children}
    </div>
  );
}

/** On phones: the one button stays at the foot of the screen once the top one has scrolled away. */
export function StickyCta({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const top = document.getElementById("bx-top-cta");
    const end = document.getElementById("bx-close");
    if (!top) return;
    let pastTop = false;
    let atEnd = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === top) pastTop = !e.isIntersecting && e.boundingClientRect.top < 0;
        if (e.target === end) atEnd = e.isIntersecting;
      }
      setShow(pastTop && !atEnd);
    });
    io.observe(top);
    if (end) io.observe(end);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`bx-sticky${show ? " is-on" : ""}`} aria-hidden={!show}>
      <a href={href} className="bx-btn" tabIndex={show ? 0 : -1}>
        {label}
      </a>
    </div>
  );
}

type Step = { title: string; body: string; img: string; alt: string };

/**
 * On a computer: the phone stays put while the steps scroll past beside it, and its screen changes to match the step
 * in the middle of the window. On a phone: each step's text, then its screen.
 */
export function StepPhone({ steps }: { steps: Step[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of refs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="bx-steps">
      <div className="bx-steps-text">
        {steps.map((s, i) => (
          <div key={s.title} className={`bx-step${i === active ? " is-on" : ""}`} data-i={i} ref={(el) => void (refs.current[i] = el)}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <div className="bx-phone bx-step-phone">
              <Image src={s.img} width={1170} height={1992} alt={s.alt} sizes="62vw" />
            </div>
          </div>
        ))}
      </div>
      <div className="bx-steps-pin" aria-hidden>
        <div className="bx-phone">
          {steps.map((s, i) => (
            <Image key={s.img} src={s.img} width={1170} height={1992} alt="" sizes="320px" className={i === active ? "is-on" : ""} />
          ))}
        </div>
      </div>
    </div>
  );
}
