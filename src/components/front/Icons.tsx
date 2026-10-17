/** The front page's few line icons: one weight, one size, drawn for this page. */
export type IconName = "board" | "feed" | "clip" | "mail" | "card" | "pin" | "lock";

const PATHS: Record<IconName, React.ReactNode> = {
  // a leaderboard: three rows, the first marked
  board: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7 9.5h6M7 12.5h6M7 15.5h6M16.5 9.5h.5M16.5 12.5h.5M16.5 15.5h.5" />
    </>
  ),
  // the feed: posts, one above the other
  feed: (
    <>
      <rect x="4.5" y="4" width="15" height="7" rx="2" />
      <rect x="4.5" y="13" width="15" height="7" rx="2" />
      <path d="M7.5 7.5h6M7.5 16.5h4" />
    </>
  ),
  // a clip: a frame with play
  clip: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M10.5 9.5v5l4-2.5-4-2.5Z" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </>
  ),
  // scoring: a flag on the green
  card: (
    <>
      <path d="M8 20V4.5l9 3.5-9 3.5" />
      <path d="M4.5 20h11" />
    </>
  ),
  pin: (
    <>
      <path d="M12 20.5s6-5.6 6-10.5a6 6 0 0 0-12 0c0 4.9 6 10.5 6 10.5Z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="bx-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
