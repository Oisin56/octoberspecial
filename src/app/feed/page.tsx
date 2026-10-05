"use client";

import Link from "next/link";
import { useT } from "@/components/Providers";
import { Comments, Feed, Loading } from "@/components/ui";

export default function FeedPage() {
  const { state, session } = useT();
  if (!state) return <Loading />;
  return (
    <div className="grid2">
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Feed</h1>
          {session && (
            <Link className="btn" href="/post">
              Add a post
            </Link>
          )}
        </div>
        <Feed />
      </div>
      <div className="stack">
        <h2>Comments from home</h2>
        <Comments />
      </div>
    </div>
  );
}
