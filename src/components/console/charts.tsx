"use client";

import { useState } from "react";

/**
 * The console's charts, drawn by hand in SVG: thin marks, a recessive grid, a hover readout, and a table for anyone
 * who'd rather read the numbers. Colours are the validated categorical order (blue, orange, aqua, yellow, magenta),
 * always in that order, always the same service in the same colour.
 */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];

/** One measure over time, with a dot and its value under the pointer. */
export function LineChart({ title, points, format = (v) => String(v), empty }: { title: string; points: { label: string; value: number | null }[]; format?: (v: number) => string; empty: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520;
  const H = 150;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!vals.length)
    return (
      <figure className="con-chart">
        <figcaption>{title}</figcaption>
        <p className="con-empty">{empty}</p>
      </figure>
    );
  const max = Math.max(1, ...vals);
  // Counts go up in whole numbers
  const step = Math.max(Number.isInteger(vals.reduce((a, v) => a + v, 0)) ? 1 : 0, niceStep(max));
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const path = points
    .map((p, i) => (p.value == null ? null : `${x(i)},${y(p.value)}`))
    .filter(Boolean)
    .join(" ");
  const h = hover != null ? points[hover] : null;
  return (
    <figure className="con-chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value == null ? "no figure" : format(p.value)}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % 3 === 0 || i === points.length - 1 ? (
            <text key={p.label} x={x(i)} y={H - 6} textAnchor="middle" className="tick">
              {p.label}
            </text>
          ) : null,
        )}
        <polyline points={path} fill="none" stroke={SERIES[0]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && hover != null && h.value != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="cross" />
            <circle cx={x(hover)} cy={y(h.value)} r="4.5" fill={SERIES[0]} stroke="#fff" strokeWidth="2" />
          </g>
        )}
        {points.map((_, i) => (
          <rect key={i} x={x(i) - (W - pad.l - pad.r) / points.length / 2} y={pad.t} width={(W - pad.l - pad.r) / points.length} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      <p className="con-chart-read" aria-live="polite">
        {h ? `${h.label}: ${h.value == null ? "no figure yet" : format(h.value)}` : `Latest: ${format(vals[vals.length - 1])}`}
      </p>
    </figure>
  );
}

/** Parts of a whole over months: stacked bars, a legend, a hover readout, and the table behind it. */
export function StackedBars({ title, months, series, value, format }: { title: string; months: string[]; series: { id: string; name: string }[]; value: (month: string, id: string) => number; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const H = 220;
  const pad = { l: 52, r: 8, t: 12, b: 28 };
  const totals = months.map((m) => series.reduce((s, x) => s + value(m, x.id), 0));
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = ((W - pad.l - pad.r) / months.length) * 0.62;
  const cx = (i: number) => pad.l + ((i + 0.5) / months.length) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const short = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "short", timeZone: "UTC" });
  return (
    <figure className="con-chart">
      <figcaption>
        {title}
        <button type="button" className="linklike" onClick={() => setTable((v) => !v)}>
          {table ? "Show the chart" : "Show as a table"}
        </button>
      </figcaption>
      <ul className="con-legend">
        {series.map((s, i) => (
          <li key={s.id}>
            <span style={{ background: SERIES[i] }} aria-hidden="true" />
            {s.name}
          </li>
        ))}
      </ul>
      {table ? (
        <div className="con-table-wrap">
          <table className="con-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="num">
                    {s.name}
                  </th>
                ))}
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m}>
                  <th scope="row">{new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" })}</th>
                  {series.map((s) => (
                    <td key={s.id} className="num" data-label={s.name}>
                      {format(value(m, s.id))}
                    </td>
                  ))}
                  <td className="num" data-label="Total">
                    {format(totals[i])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Use "Show as a table" for the figures.`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
                  {format(t)}
                </text>
              </g>
            ))}
            {months.map((m, i) => {
              let base = 0;
              return (
                <g key={m} opacity={hover == null || hover === i ? 1 : 0.45}>
                  {series.map((s, k) => {
                    const v = value(m, s.id);
                    if (v <= 0) return null;
                    const y0 = y(base);
                    base += v;
                    const y1 = y(base);
                    // 2px gap between the parts
                    return <rect key={s.id} x={cx(i) - bw / 2} y={y1 + 1} width={bw} height={Math.max(0, y0 - y1 - 2)} rx="2" fill={SERIES[k]} />;
                  })}
                  <text x={cx(i)} y={H - 8} textAnchor="middle" className="tick">
                    {short(m)}
                  </text>
                  <rect x={cx(i) - (W - pad.l - pad.r) / months.length / 2} y={pad.t} width={(W - pad.l - pad.r) / months.length} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          <p className="con-chart-read" aria-live="polite">
            {hover != null
              ? `${new Date(`${months[hover]}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" })}: ${format(totals[hover])} (${series
                  .filter((s) => value(months[hover], s.id) > 0)
                  .map((s) => `${s.name.split(" (")[0]} ${format(value(months[hover], s.id))}`)
                  .join(", ") || "nothing spent"})`
              : "Point at a month for its figures"}
          </p>
        </>
      )}
    </figure>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}
