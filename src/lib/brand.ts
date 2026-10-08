/** The product's name and where it lives. One place, so a rename is one edit. */
export const BRAND = {
  name: "MyGolfSpecial",
  short: "MGS",
  domain: "mygolfspecial.com",
  tagline: "Your golf trip, covered like a major.",
  /** The tournament shown as the live example on the front page. */
  demoSlug: process.env.NEXT_PUBLIC_DEMO_TOURNAMENT || "october-special-2026",
} as const;
