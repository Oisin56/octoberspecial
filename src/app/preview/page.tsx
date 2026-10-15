import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { FrontPage } from "@/components/front/FrontPage";

export const dynamic = "force-dynamic";

/** The new front page, on a quiet address for a look before it replaces the live one. Kept out of search. */
export const metadata: Metadata = {
  title: { absolute: `${BRAND.name}: your golf, covered like a major` },
  robots: { index: false, follow: false },
};

export default function Preview() {
  return <FrontPage />;
}
