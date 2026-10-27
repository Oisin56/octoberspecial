"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { BioFlow } from "@/components/BioFlow";
import { usePlayerMe } from "@/components/PlayerAsks";

/** Your player bio: the six questions, on your own phone. */
export default function BioPage() {
  const { session, href, state, sessionReady, refresh } = useT();
  const router = useRouter();
  const { me } = usePlayerMe(true);
  if (!sessionReady) return <Loading />;
  if (!session?.playerId || session.role === "fan")
    return (
      <div className="panel stack">
        <h1>Your player bio</h1>
        <p>This is for players, on their own phone. Open the link your organiser sent you first.</p>
        <Link className="btn secondary" href={href("/")}>
          Back to the tournament
        </Link>
      </div>
    );
  if (!me || !state) return <Loading />;
  const name = state.players.find((p) => p.id === session.playerId)?.name ?? session.name;
  return (
    <BioFlow
      initial={me.bio}
      name={name}
      intro={false}
      onFinish={() => {
        refresh();
        router.push(href("/players"));
      }}
    />
  );
}
