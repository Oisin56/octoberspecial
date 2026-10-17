"use client";

import { useT } from "@/components/Providers";
import { Board, Loading } from "@/components/ui";
import { SocialFeed } from "@/components/SocialFeed";

/** Everything from the tournament, newest first. On a wide screen the leaderboard stays beside it. */
export default function FeedPage() {
  const { state, session } = useT();
  if (!state) return <Loading />;
  if (state.tournament.feed_on === false && session?.role !== "organiser")
    return (
      <div className="article">
        <h2>No feed for this one</h2>
        <p>The organiser has switched the feed off. The scores and the leaderboard are all here.</p>
      </div>
    );
  return (
    <div className="sf-page sf-page-wide">
      <aside className="sf-side" aria-label="Leaderboard">
        <Board />
      </aside>
      <div className="sf-main">
        <h1 className="sf-page-title">Feed</h1>
        <SocialFeed />
      </div>
    </div>
  );
}
