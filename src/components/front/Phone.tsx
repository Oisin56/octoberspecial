import Image from "next/image";
import screens from "@/lib/screens.json";

/**
 * A phone, drawn to a real handset's proportions: a metal edge, the side buttons, the camera cut-out and the
 * status bar (9:41, signal, Wi-Fi, battery). The screens are taken full height (frontshots.mjs), with a strip at
 * the top in the screen's own colour for the status bar to sit on. Every size is a share of the phone's width.
 */

export type ScreenName = keyof typeof screens;

/** Is the top of this screen dark (white status bar text)? */
export const darkTop = (name: string) => !!(screens as unknown as Record<string, { dark?: boolean }>)[name]?.dark;

export function StatusBar({ dark }: { dark: boolean }) {
  return (
    <span className={`dv-status${dark ? " is-dark" : ""}`} aria-hidden>
      <span className="dv-time">9:41</span>
      <span className="dv-island" />
      <span className="dv-icons">
        <svg viewBox="0 0 18 12" className="dv-signal">
          <rect x="0" y="8" width="3" height="4" rx="0.8" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
          <rect x="10" y="3" width="3" height="9" rx="0.8" />
          <rect x="15" y="0" width="3" height="12" rx="0.8" />
        </svg>
        <svg viewBox="0 0 16 12" className="dv-wifi">
          <path d="M8 11.6 5.6 9.2a3.4 3.4 0 0 1 4.8 0L8 11.6Z" />
          <path d="M3.4 7a6.5 6.5 0 0 1 9.2 0l-1.5 1.5a4.4 4.4 0 0 0-6.2 0L3.4 7Z" />
          <path d="M1.1 4.7a9.8 9.8 0 0 1 13.8 0l-1.5 1.5a7.7 7.7 0 0 0-10.8 0L1.1 4.7Z" />
        </svg>
        <svg viewBox="0 0 27 13" className="dv-battery">
          <rect x="0.5" y="0.5" width="22" height="12" rx="3.6" fill="none" strokeWidth="1" />
          <rect x="2.2" y="2.2" width="16.5" height="8.6" rx="2.2" />
          <path d="M24 4.4v4.2a2.3 2.3 0 0 0 0-4.2Z" />
        </svg>
      </span>
    </span>
  );
}

/** The frame: put a screen image in it (src), or anything else as children (an iframe, stacked images). */
export function Phone({
  src,
  alt = "",
  sizes = "320px",
  dark,
  className = "",
  children,
}: {
  src?: string;
  alt?: string;
  sizes?: string;
  /** White status bar text (the screen's top is dark). Taken from the screen's name if not given. */
  dark?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const name = src?.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
  return (
    <div className={`dv ${className}`}>
      <span className="dv-key dv-action" aria-hidden />
      <span className="dv-key dv-up" aria-hidden />
      <span className="dv-key dv-down" aria-hidden />
      <span className="dv-key dv-power" aria-hidden />
      <div className="dv-body">
        <div className="dv-screen">
          {children ?? (src ? <Image src={src} width={1170} height={2532} alt={alt} sizes={sizes} /> : null)}
          <StatusBar dark={dark ?? darkTop(name)} />
        </div>
      </div>
    </div>
  );
}
