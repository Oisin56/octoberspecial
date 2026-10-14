/** The product's name and where it lives. One place, so a rename is one edit. */
export const BRAND = {
  name: "MyGolfBroadcast",
  /** The name in two parts, for the wordmark: My·Golf·Broadcast with Golf picked out */
  mark: ["My", "Golf", "Broadcast"],
  short: "GolfBroadcast",
  /** Shown in the footer once the domain is live (set NEXT_PUBLIC_SITE_DOMAIN) */
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN || "",
  tagline: "Your golf, covered like a major.",
} as const;
