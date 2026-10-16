import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { FrontPage } from "@/components/front/FrontPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name}: every round, covered like a major` },
  description: "A live leaderboard, round reports and a film to keep, for mates' rounds, golf trips, societies and your own golf.",
};

export default function Front() {
  return <FrontPage />;
}
