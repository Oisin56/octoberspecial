"use client";

import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { mediaUrl } from "@/lib/supabase";

export default function Players() {
  const { state, summary } = useT();
  if (!state || !summary) return <Loading />;
  return (
    <>
      <h1 style={{ marginBottom: 14 }}>The players</h1>
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {state.players.map((p) => {
          const photo = mediaUrl(p.photo_path);
          const facts: [string, string | number | null][] = [
            ["Handicap", p.handicap],
            ["Home club", p.home_club],
            ["Best club", p.best_club],
            ["Worst club", p.worst_club],
            ["Known weakness", p.weakness],
            ["Birdies so far", summary.birdies[p.id]],
            ["Greens hit", summary.gir.counts[p.id]],
          ];
          return (
            <article className="panel" key={p.id}>
              <div className="profile">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="avatar" src={photo} alt={p.name} />
                ) : (
                  <div className="avatar" aria-hidden>
                    {p.name[0]}
                  </div>
                )}
                <div>
                  <h2>{p.name}</h2>
                  {p.nickname && <div className="display muted">“{p.nickname}”</div>}
                  <dl className="facts">
                    {facts
                      .filter(([, v]) => v != null && v !== "")
                      .map(([k, v]) => (
                        <div key={k} style={{ display: "contents" }}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                  </dl>
                </div>
              </div>
              {p.bio && <p>{p.bio}</p>}
              {p.quote && (
                <blockquote style={{ margin: "8px 0 0", fontStyle: "italic", fontSize: 20 }}>“{p.quote}”</blockquote>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
