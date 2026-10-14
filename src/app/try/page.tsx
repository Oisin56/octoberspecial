import type { Metadata } from "next";
import { TryScorecard } from "@/components/front/TryScorecard";

export const metadata: Metadata = { title: "Try the scorecard" };

export default function Try() {
  return <TryScorecard />;
}
