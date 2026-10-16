import type { Metadata } from "next";
import { TryShell } from "@/components/front/TryShell";

export const metadata: Metadata = {
  title: "A sample round",
  description: "Three holes on the real scorecard, then what everyone at home saw. Nothing is saved.",
};

export default function Try() {
  return <TryShell />;
}
