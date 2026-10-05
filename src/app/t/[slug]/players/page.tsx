"use client";

import { useT } from "@/components/Providers";
import { Loading, pts } from "@/components/ui";
import { mediaUrl } from "@/lib/supabase";
import type { PlayerRow } from "@/lib/types";

export default function Players() {
  const { state, summary } = useT();
  if (!state || !summary) return <Loading />;
  const teams = state.tournament.teams ?? [];
  const groups: { name: string | null; color?: string; players: PlayerRow[] }[] = teams.length
    ? [
        ...teams.map((t, i) => ({ name: t.name, color: t.color || `var(--team-${i})`, players: state.players.filter((p) => p.team_id === t.id) })),
        { name: "No team", players: state.players.filter((p) => !teams.some((t) => t.id === p.team_id)) },
      ].filter((g) => g.players.length)
    : [{ name: null, players: state.players }];

  return (
    <>
      <h1 style={{ marginBottom: 14 }}>The players</h1>
      {groups.map((g) => (
        <section key={g.name ?? "all"} className="section" style={{ marginTop: g.name ? 24 : 0 }}>
          {g.name && (
            <h2 style={{ marginBottom: 10, borderLeft: `8px solid ${g.color ?? "var(--board)"}`, paddingLeft: 10 }}>{g.name}</h2>
          )}
          <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            {g.players.map((p) => {
              const photo = mediaUrl(p.photo_path);
              const facts: [string, string | number | null][] = [
                ["Handicap", p.handicap],
                ["Home club", p.home_club],
                ["Best club", p.best_club],
                ["Worst club", p.worst_club],
                ["Known weakness", p.weakness],
                ["Points won", pts(summary.playerRoundPoints[p.id] ?? 0)],
                ["Birdies so far", summary.tallies.birdies[p.id] ?? 0],
                ["Greens hit", summary.tallies.gir[p.id] ?? 0],
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
                  {p.quote && <blockquote style={{ margin: "8px 0 0", fontStyle: "italic", fontSize: 20 }}>“{p.quote}”</blockquote>}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
