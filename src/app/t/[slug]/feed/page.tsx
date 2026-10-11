"use client";

import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { SocialFeed } from "@/components/SocialFeed";

/** Everything from the tournament in one column, newest first. */
export default function FeedPage() {
  const { state } = useT();
  if (!state) return <Loading />;
  return (
    <div className="sf-page">
      <h1 className="sf-page-title">Feed</h1>
      <SocialFeed />
    </div>
  );
}
