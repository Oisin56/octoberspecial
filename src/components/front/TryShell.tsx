"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { SampleRound, STEP_HELP, type SampleStep } from "./SampleRound";

const ORDER: SampleStep[] = ["play", "record", "highlight", "feed"];

/**
 * /try. On a phone: the sample round itself, full screen. On a computer: a phone in the middle running the same page
 * (so every screen is exactly the phone's), with a line of guidance beside it for each step.
 */
export function TryShell() {
  return (
    <Suspense fallback={null}>
      <Shell />
    </Suspense>
  );
}

function Shell() {
  const sp = useSearchParams();
  const embed = sp.get("embed") === "1";
  const [wide, setWide] = useState<boolean | null>(null);
  const [step, setStep] = useState<SampleStep>("play");

  useEffect(() => {
    if (embed) return;
    const m = window.matchMedia("(min-width: 960px)");
    const on = () => setWide(m.matches);
    const t = setTimeout(on, 0);
    m.addEventListener("change", on);
    return () => {
      clearTimeout(t);
      m.removeEventListener("change", on);
    };
  }, [embed]);

  // The phone inside tells the page beside it which step it's on
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === "sample-step") setStep(e.data.step);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  if (embed) return <SampleRound onStep={(s) => window.parent !== window && window.parent.postMessage({ type: "sample-step", step: s }, location.origin)} />;
  if (wide === null) return <div className="sr-loading" aria-busy="true" />;
  if (!wide) return <SampleRound />;

  const help = STEP_HELP[step];
  return (
    <div className="theme-root tr" data-theme="clubhouse">
      <header className="tr-bar">
        <Link href="/preview" className="tr-mark">
          {BRAND.mark[0]}
          <b>{BRAND.mark[1]}</b>
          {BRAND.mark[2]}
        </Link>
        <Link href="/preview" className="tr-back">
          Back to the front page
        </Link>
      </header>
      <div className="tr-grid">
        <div className="tr-copy">
          <h1>A sample round</h1>
          <p className="tr-lead">Three holes on the real scorecard, then what everyone at home saw. Nothing is saved.</p>
          <ol className="tr-steps">
            {ORDER.map((s) => (
              <li key={s} className={s === step ? "is-on" : ORDER.indexOf(s) < ORDER.indexOf(step) ? "is-done" : ""}>
                <strong>{STEP_HELP[s].title}</strong>
                {s === step && <span>{help.body}</span>}
              </li>
            ))}
          </ol>
        </div>
        <div className="tr-phone">
          <iframe src="/try?embed=1" title="The sample round on a phone" />
        </div>
      </div>
    </div>
  );
}
