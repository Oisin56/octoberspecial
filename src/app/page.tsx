import Link from "next/link";
import { redirect } from "next/navigation";
import { adminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function Landing() {
  const home = process.env.HOME_TOURNAMENT;
  if (home) redirect(`/t/${home}`);

  const { data } = await adminClient()
    .from("public_tournaments")
    .select("slug,name,subtitle,start_date,end_date")
    .eq("published", true)
    .order("start_date", { ascending: false, nullsFirst: false });

  return (
    <div className="theme-root" data-theme="clubhouse">
      <header className="site-head">
        <div className="wrap" style={{ padding: "22px 16px" }}>
          <span className="site-title">Tournament Live</span>
        </div>
      </header>
      <main className="wrap">
        <section className="board" style={{ marginTop: 8 }}>
          <div className="board-title">Your golf trip, scored live</div>
          <p style={{ color: "var(--tile)", fontSize: 20, margin: "0 0 14px", maxWidth: "52ch" }}>
            Hole-by-hole scoring for any format, a live leaderboard for everyone at home, and match reports written for you.
          </p>
          <Link href="/new" className="btn" style={{ background: "var(--tile)", color: "var(--board)" }}>
            Create a tournament
          </Link>
        </section>
        <h2 className="section" style={{ marginBottom: 10 }}>
          Tournaments
        </h2>
        <div className="round-list">
          {(data ?? []).map((t) => (
            <Link key={t.slug} href={`/t/${t.slug}`} className="round-item" style={{ gridTemplateColumns: "1fr auto" }}>
              <span>
                <span className="display" style={{ fontSize: 21, fontWeight: 700, display: "block" }}>
                  {t.name}
                </span>
                {t.subtitle && <span className="meta">{t.subtitle}</span>}
              </span>
              <span className="res small">{t.start_date ?? ""}</span>
            </Link>
          ))}
          {!data?.length && <p className="muted">No tournaments published yet.</p>}
        </div>
      </main>
    </div>
  );
}
