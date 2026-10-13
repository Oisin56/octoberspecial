"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";

/**
 * GPS test bench (site owner only). Search GolfAPI for a club, load a course and check its points on a
 * satellite map, hole by hole. On the course, "Use my location" shows the distances to the front, centre
 * and back of the green, to compare with a rangefinder. Nothing here is used by tournaments yet.
 */

type Raw = Record<string, unknown>;
interface Pt {
  hole: number;
  poi: number;
  loc: number;
  lat: number;
  lng: number;
}

const POI: Record<number, string> = {
  1: "Green",
  2: "Green bunker",
  3: "Fairway bunker",
  4: "Water",
  5: "Trees",
  6: "100 marker",
  7: "150 marker",
  8: "200 marker",
  9: "Dogleg",
  10: "Road",
  11: "Front tee",
  12: "Back tee",
};
const LOC: Record<number, string> = { 1: "front", 2: "centre", 3: "back" };
const COLOUR: Record<number, string> = { 1: "#22c55e", 2: "#facc15", 3: "#fde68a", 4: "#38bdf8", 5: "#166534", 6: "#e5e7eb", 7: "#e5e7eb", 8: "#e5e7eb", 9: "#fb923c", 10: "#a8a29e", 11: "#ffffff", 12: "#ef4444" };

const GREEN: Record<number, string> = { 1: "#bbf7d0", 2: "#22c55e", 3: "#14532d" };
const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v));
const arr = (v: unknown) => (Array.isArray(v) ? (v as Raw[]) : []);

function yards(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.09361);
}

function points(coords: Raw | null): Pt[] {
  return arr(coords?.coordinates)
    .map((c) => ({ hole: num(c.hole), poi: num(c.poi), loc: num(c.location), lat: num(c.latitude ?? c.lat), lng: num(c.longitude ?? c.lng ?? c.lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** Pars and tee lengths from the course details, whatever they're called. */
function card(details: Raw | null) {
  const d = (details?.course as Raw) ?? details ?? {};
  const parKey = Object.keys(d).find((k) => /^pars?/i.test(k) && Array.isArray(d[k]));
  const pars = parKey ? (d[parKey] as unknown[]).map(num) : [];
  const tees = arr(d.tees).map((t) => {
    const lengths: number[] = [];
    for (const [k, v] of Object.entries(t)) {
      const m = /^length(\d+)$/i.exec(k);
      if (m) lengths[Number(m[1]) - 1] = num(v);
    }
    return { name: String(t.teeName ?? t.teeColor ?? t.name ?? "Tee"), lengths };
  });
  return { pars, tees, unit: String(d.lengthUnit ?? d.measure ?? d.measureUnit ?? "") };
}

export default function GpsLab() {
  const [owner, setOwner] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [q, setQ] = useState("");
  const [clubs, setClubs] = useState<Raw[] | null>(null);
  const [left, setLeft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ name: string; details: Raw; coords: Raw } | null>(null);
  const [hole, setHole] = useState(0);
  const [me, setMe] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<{ map: LMap; layer: LayerGroup; me: LayerGroup } | null>(null);
  const watch = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then((j) => setOwner(!!j.owner))
      .catch(() => setOwner(false));
  }, []);

  const pts = useMemo(() => points(loaded?.coords ?? null), [loaded]);
  const sc = useMemo(() => card(loaded?.details ?? null), [loaded]);
  const holes = useMemo(() => [...new Set(pts.map((p) => p.hole).filter((h) => h > 0))].sort((a, b) => a - b), [pts]);
  const green = (h: number, loc: number) => pts.find((p) => p.hole === h && p.poi === 1 && p.loc === loc);

  // Draw the points on the satellite map
  useEffect(() => {
    if (!loaded || !mapEl.current) return;
    let gone = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (gone || !mapEl.current) return;
      if (!map.current) {
        const m = L.map(mapEl.current, { zoomControl: true });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 20,
          maxNativeZoom: 19,
          attribution: "Imagery © Esri",
        }).addTo(m);
        map.current = { map: m, layer: L.layerGroup().addTo(m), me: L.layerGroup().addTo(m) };
      }
      const { map: m, layer } = map.current;
      layer.clearLayers();
      const shown = hole ? pts.filter((p) => p.hole === hole) : pts;
      for (const p of shown) {
        L.circleMarker([p.lat, p.lng], { radius: p.poi === 1 ? 7 : 5, color: "#000", weight: 1, fillColor: p.poi === 1 ? (GREEN[p.loc] ?? COLOUR[1]) : (COLOUR[p.poi] ?? "#f0f"), fillOpacity: 0.95 })
          .bindTooltip(`Hole ${p.hole} · ${POI[p.poi] ?? `POI ${p.poi}`}${LOC[p.loc] ? ` (${LOC[p.loc]})` : ""}`)
          .addTo(layer);
      }
      if (shown.length) m.fitBounds(L.latLngBounds(shown.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30], maxZoom: 18 });
    })();
    return () => {
      gone = true;
    };
  }, [loaded, hole, pts]);

  // Where I am
  useEffect(() => {
    if (!me || !map.current) return;
    (async () => {
      const L = (await import("leaflet")).default;
      const g = map.current!.me;
      g.clearLayers();
      L.circle([me.lat, me.lng], { radius: me.acc, color: "#3b82f6", weight: 1, fillOpacity: 0.15 }).addTo(g);
      L.circleMarker([me.lat, me.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(g);
    })();
  }, [me]);

  useEffect(
    () => () => {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
      map.current?.map.remove();
      map.current = null;
    },
    [],
  );

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "owner", pin }) });
    if (r.ok) setOwner(true);
    else setErr("Wrong PIN");
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/lab/gps?q=${encodeURIComponent(q)}`);
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Search failed");
    setClubs(arr(j.data?.clubs));
    if (j.data?.apiRequestsLeft != null) setLeft(String(j.data.apiRequestsLeft));
  }

  async function load(id: string, name: string) {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/lab/gps?course=${encodeURIComponent(id)}`);
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Couldn't load the course");
    setLoaded({ name, details: j.details, coords: j.coords });
    setHole(0);
    const l = j.coords?.apiRequestsLeft ?? j.details?.apiRequestsLeft;
    if (l != null) setLeft(String(l));
  }

  function locate() {
    if (watch.current != null) return;
    watch.current = navigator.geolocation.watchPosition(
      (p) => setMe({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => setErr("Location not available: allow location for this site"),
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
  }

  async function copy() {
    await navigator.clipboard.writeText(JSON.stringify({ name: loaded?.name, details: loaded?.details, coords: loaded?.coords }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const shell = (children: React.ReactNode) => (
    <div className="theme-root" data-theme="clubhouse">
      <main className="wrap stack" style={{ paddingTop: 20, paddingBottom: 40 }}>
        <h1>GPS test</h1>
        {children}
      </main>
    </div>
  );

  if (owner === null) return shell(<p>Loading…</p>);
  if (!owner)
    return shell(
      <form className="panel stack" onSubmit={login} style={{ maxWidth: 420 }}>
        <div className="field">
          <label htmlFor="pin">Site owner PIN</label>
          <input id="pin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoFocus />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn">Continue</button>
      </form>,
    );

  return shell(
    <>
      <form className="panel stack" onSubmit={search}>
        <div className="field">
          <label htmlFor="q">Find a club</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Birr" />
        </div>
        <button className="btn" disabled={busy || q.trim().length < 3}>
          {busy ? "Working…" : "Search (0.1 of a call)"}
        </button>
        {left && <p className="muted">API calls left: {left}</p>}
        {err && <p className="error">{err}</p>}
      </form>

      {clubs && (
        <div className="panel stack">
          {clubs.length === 0 && <p>No clubs found.</p>}
          {clubs.map((c, i) => (
            <div key={String(c.clubID ?? i)} className="stack" style={{ gap: 6 }}>
              <strong>
                {String(c.clubName ?? c.name ?? "Club")} <span className="muted">{[c.city, c.country].filter(Boolean).join(", ")}</span>
              </strong>
              {arr(c.courses).map((co, k) => {
                const id = String(co.courseID ?? co.id ?? "");
                const name = `${String(c.clubName ?? "")} – ${String(co.courseName ?? co.name ?? "Course")}`;
                const gps = co.hasGPS ?? co.gps;
                return (
                  <button key={id || k} className="btn secondary" disabled={busy || !id} onClick={() => load(id, name)} style={{ textAlign: "left" }}>
                    {String(co.courseName ?? co.name ?? "Course")}
                    {co.numHoles ? ` · ${co.numHoles} holes` : ""}
                    {gps != null ? (Number(gps) ? " · has GPS" : " · no GPS") : ""} · load (2 calls, free if loaded before)
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {loaded && (
        <div className="stack">
          <h2>{loaded.name}</h2>
          {pts.length === 0 && <p className="error">No coordinates came back for this course.</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button className={`btn ${hole === 0 ? "" : "secondary"}`} onClick={() => setHole(0)} style={{ minWidth: 56 }}>
              All
            </button>
            {holes.map((h) => (
              <button key={h} className={`btn ${hole === h ? "" : "secondary"}`} onClick={() => setHole(h)} style={{ minWidth: 48 }}>
                {h}
              </button>
            ))}
          </div>
          {hole > 0 && (
            <div className="panel stack">
              <strong>Hole {hole} from where you are</strong>
              {!me ? (
                <button className="btn" onClick={locate}>
                  Use my location
                </button>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 12, textAlign: "center" }}>
                    {[1, 2, 3].map((l) => {
                      const g = green(hole, l);
                      return (
                        <div key={l} style={{ flex: 1 }}>
                          <div className="muted">{LOC[l]}</div>
                          <div style={{ fontSize: 34, fontWeight: 700 }}>{g ? yards(me, g) : "–"}</div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="muted">Yards. Phone accuracy right now: ±{Math.round(me.acc * 1.09361)} yards.</p>
                </>
              )}
            </div>
          )}

          <div ref={mapEl} style={{ height: "62vh", minHeight: 320, borderRadius: 12, overflow: "hidden" }} />
          <p className="muted" style={{ fontSize: 13 }}>
            Green: light front, mid centre, dark back · yellow bunkers · blue water · white front tee · red back tee · orange dogleg
          </p>

          <div className="panel" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 14, borderSpacing: "10px 4px" }}>
              <thead>
                <tr>
                  <th align="left">Hole</th>
                  <th>Par</th>
                  <th>Green F/C/B</th>
                  <th>Bunkers</th>
                  <th>Water</th>
                  <th>Tee to centre</th>
                  {sc.tees.slice(0, 3).map((t, i) => (
                    <th key={i}>Card: {t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holes.map((h) => {
                  const tee = pts.find((p) => p.hole === h && p.poi === 12) ?? pts.find((p) => p.hole === h && p.poi === 11);
                  const c = green(h, 2);
                  return (
                    <tr key={h}>
                      <td>{h}</td>
                      <td align="center">{Number.isFinite(sc.pars[h - 1]) ? sc.pars[h - 1] : "–"}</td>
                      <td align="center">{[1, 2, 3].map((l) => (green(h, l) ? "✓" : "✗")).join(" ")}</td>
                      <td align="center">{pts.filter((p) => p.hole === h && (p.poi === 2 || p.poi === 3)).length}</td>
                      <td align="center">{pts.filter((p) => p.hole === h && p.poi === 4).length}</td>
                      <td align="center">{tee && c ? `${yards(tee, c)} yds` : "–"}</td>
                      {sc.tees.slice(0, 3).map((t, i) => (
                        <td key={i} align="center">
                          {Number.isFinite(t.lengths[h - 1]) ? t.lengths[h - 1] : "–"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 13 }}>
              &quot;Tee to centre&quot; is measured in a straight line from the tee point to the centre of the green, so doglegs read shorter than the card.
              {sc.unit ? ` Card lengths are in ${sc.unit}.` : ""}
            </p>
          </div>
          <button className="btn secondary" onClick={copy}>
            {copied ? "Copied" : "Copy the data for Claude"}
          </button>
        </div>
      )}
    </>,
  );
}
