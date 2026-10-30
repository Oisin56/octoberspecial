"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { OwnerGate, type Gate } from "./OwnerTools";
import { act, api } from "./kit";

export interface ConsoleUser {
  email: string;
  role: "owner" | "support";
}

const Ctx = createContext<{ user: ConsoleUser; needs: number; refreshNeeds: () => void } | null>(null);

export function useConsole() {
  const c = useContext(Ctx);
  if (!c) throw new Error("Console context missing");
  return c;
}

const NAV: { href: string; label: string; owner?: boolean }[] = [
  { href: "/console", label: "Overview" },
  { href: "/console/needs", label: "Needs you" },
  { href: "/console/tournaments", label: "Tournaments" },
  { href: "/console/people", label: "People" },
  { href: "/console/email", label: "Email" },
  { href: "/console/money", label: "Money", owner: true },
  { href: "/console/health", label: "Health" },
  { href: "/console/writing", label: "Writing", owner: true },
  { href: "/console/activity", label: "Activity" },
  { href: "/console/settings", label: "Settings", owner: true },
];
const PHONE = ["/console", "/console/needs", "/console/tournaments", "/console/people"];

/** The console's frame: sign in (email, then the second check), then the sections and the search box. */
export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<ConsoleUser | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [needs, setNeeds] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ user: ConsoleUser | null; needs?: number; email?: string | null; allowed?: boolean; passkeys?: number; pin?: boolean }>("me");
    if (r.j.user) {
      setUser(r.j.user);
      setNeeds(r.j.needs ?? 0);
      setGate(null);
    } else {
      setUser(null);
      setGate({ email: r.j.email ?? null, ownerAccount: !!r.j.allowed, passkeys: r.j.passkeys ?? 0, pin: !!r.j.pin });
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const inNow = useCallback(async () => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) return router.push(next);
    await load();
  }, [load, router]);

  // The button in the check email lands here
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("check");
    if (!token) return;
    history.replaceState(null, "", path);
    act({ action: "link", token }, "/api/owner").then((r) => (r.ok ? inNow() : setErr(String(r.j.error ?? "That link didn't work. Ask for a new code."))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user)
    return (
      <div className="con con-out">
        <header className="con-out-head">
          <Link href="/" className="con-brand">
            {BRAND.name} <span>Console</span>
          </Link>
        </header>
        <main className="con-out-main">
          <h1>Console</h1>
          {err && <p className="error">{err}</p>}
          {gate && <OwnerGate gate={gate} post={(b) => act(b, "/api/owner")} onIn={inNow} />}
        </main>
      </div>
    );

  const nav = NAV.filter((x) => !x.owner || user.role === "owner");
  const on = (href: string) => (href === "/console" ? path === "/console" : path.startsWith(href));
  const label = (x: (typeof NAV)[number]) => (
    <>
      {x.label}
      {x.href === "/console/needs" && needs > 0 && <span className="con-badge">{needs}</span>}
    </>
  );

  return (
    <Ctx.Provider value={{ user, needs, refreshNeeds: load }}>
      <div className="con">
        <a className="con-skip" href="#con-main">
          Skip to the page
        </a>
        <aside className="con-rail" aria-label="Console">
          <Link href="/console" className="con-brand">
            {BRAND.name} <span>Console</span>
          </Link>
          <nav>
            {nav.map((x) => (
              <Link key={x.href} href={x.href} aria-current={on(x.href) ? "page" : undefined}>
                {label(x)}
              </Link>
            ))}
          </nav>
          <div className="con-me">
            <span>{user.email}</span>
            <span>{user.role === "owner" ? "Owner" : "Support"}</span>
            <Link href="/account">My golf</Link>
          </div>
        </aside>

        <div className="con-body">
          <div className="con-top">
            <Link href="/console" className="con-brand con-brand-phone">
              {BRAND.name} <span>Console</span>
            </Link>
            <ConsoleSearch />
          </div>
          <main id="con-main" className="con-main">
            {children}
          </main>
        </div>

        <nav className="con-tabs" aria-label="Console">
          {nav
            .filter((x) => PHONE.includes(x.href))
            .map((x) => (
              <Link key={x.href} href={x.href} aria-current={on(x.href) ? "page" : undefined} onClick={() => setMore(false)}>
                {label(x)}
              </Link>
            ))}
          <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} aria-current={nav.some((x) => !PHONE.includes(x.href) && on(x.href)) ? "page" : undefined}>
            More
          </button>
        </nav>
        {more && (
          <div className="con-more" role="dialog" aria-label="More" onClick={(e) => e.target === e.currentTarget && setMore(false)}>
            <div>
              {nav
                .filter((x) => !PHONE.includes(x.href))
                .map((x) => (
                  <Link key={x.href} href={x.href} onClick={() => setMore(false)}>
                    {x.label}
                  </Link>
                ))}
              <Link href="/account">My golf</Link>
              <button type="button" className="btn secondary block" onClick={() => setMore(false)}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

type Hit = { kind: "t" | "p"; key: string; title: string; sub: string; href: string };

/** One box finds any tournament, person or email from anywhere in the console. */
function ConsoleSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [at, setAt] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      const t = setTimeout(() => setHits(null), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      const r = await api<{ tournaments: { id: string; name: string; status: string; organiser: string | null }[]; people: { id: string; email: string; name: string | null; roles: string[] }[] }>("search", { q });
      if (!r.ok) return;
      setAt(-1);
      setHits([
        ...r.j.tournaments.map((t) => ({ kind: "t" as const, key: t.id, title: t.name, sub: ["Tournament", t.organiser].filter(Boolean).join(", "), href: `/console/tournaments/${t.id}` })),
        ...r.j.people.map((p) => ({ kind: "p" as const, key: p.email, title: p.name || p.email, sub: p.name ? p.email : "Person", href: `/console/people/${p.id}` })),
      ]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setHits(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const go = (h: Hit) => {
    setHits(null);
    setQ("");
    router.push(h.href);
  };
  return (
    <div className="con-search" ref={box} role="search">
      <label htmlFor="con-q" className="sr-only">
        Find a tournament, person or email
      </label>
      <input
        id="con-q"
        type="search"
        placeholder="Find a tournament, person or email"
        value={q}
        autoComplete="off"
        role="combobox"
        aria-expanded={!!hits?.length}
        aria-controls="con-hits"
        aria-activedescendant={at >= 0 ? `hit-${at}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(hits[Math.max(0, at)]);
          } else if (e.key === "Escape") setHits(null);
        }}
      />
      {hits && (
        <ul id="con-hits" className="con-hits" role="listbox">
          {hits.length === 0 && <li className="con-hit-none">Nothing found for “{q.trim()}”</li>}
          {hits.map((h, i) => (
            <li key={`${h.kind}${h.key}`} id={`hit-${i}`} role="option" aria-selected={i === at}>
              <button type="button" onClick={() => go(h)}>
                <strong>{h.title}</strong>
                <span>{h.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
