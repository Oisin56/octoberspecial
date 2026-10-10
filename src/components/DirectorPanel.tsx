"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "./Providers";
import { mediaUrl } from "@/lib/supabase";
import { bugText, type ScoreBug } from "@/lib/scorebug";
import { MOODS, musicFits, planSeconds, segmentSeconds, voiceSeconds, type Brief, type Mood, type Plan, type PlanMusic, type ReelRow, type Segment } from "@/lib/director-types";

interface Configured {
  claude: boolean;
  shotstack: boolean;
  shotstackEnv: string;
  voice: boolean;
  veo: boolean;
}

type BugPreview = { before: ScoreBug; after: ScoreBug | null; beforeUrl: string; afterUrl: string | null };
const TAGS_FINISH = ["birdie", "eagle", "chip-in", "long putt", "hole in one"];

/** Shows just the corner of the full-frame panel image, at half size. */
function PanelImg({ src, portrait, alt }: { src: string; portrait: boolean; alt: string }) {
  return (
    <div style={{ width: 310, height: 240, overflow: "hidden", background: "#3a4a40", borderRadius: 6, position: "relative", flex: "0 0 auto" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} style={{ position: "absolute", width: portrait ? 540 : 960, left: portrait ? -115 : 0, top: portrait ? -60 : 0, maxWidth: "none" }} />
    </div>
  );
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function DirectorPanel() {
  const { state, api, href, refresh } = useT();
  const [reels, setReels] = useState<ReelRow[]>([]);
  const [cfg, setCfg] = useState<Configured | null>(null);
  const [music, setMusic] = useState<string | null>(null);
  const [current, setCurrent] = useState<ReelRow | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [brief, setBrief] = useState<Brief>({ roundNumber: null, length: 180, aspect: "16:9", voice: true, veo: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  /** Film length on this screen when the music was last composed (the server decides at render) */
  const [composedAt, setComposedAt] = useState<number | null>(null);

  const call = useCallback((body: Record<string, unknown>) => api("/api/director", body), [api]);
  const [bugs, setBugs] = useState<Record<string, BugPreview>>({});

  // Score panel previews follow the plan as you edit it
  const bugKey = plan ? JSON.stringify([plan.aspect, plan.segments.map((x) => (x.kind === "clip" ? [x.id, x.round, x.hole, x.bug, x.finishes, x.playerIds] : null))]) : "";
  useEffect(() => {
    if (!plan) return;
    const tm = setTimeout(async () => {
      const r = await call({ action: "bugCards", plan });
      if (r.ok) setBugs(r.j.bugs as Record<string, BugPreview>);
    }, 500);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugKey, call]);

  const load = useCallback(async () => {
    const r = await call({ action: "list" });
    if (!r.ok) return setMsg(String(r.j.error ?? "Couldn't load reels"));
    const list = r.j.reels as ReelRow[];
    setReels(list);
    setCfg(r.j.configured as Configured);
    // Coming back: reopen a film that's rendering, or the latest one if it was worked on in the last hour
    setCurrent((cur) => {
      if (cur) return list.find((x) => x.id === cur.id) ?? cur;
      const recent = (x: ReelRow) => Date.now() - new Date(x.updated_at ?? x.created_at).getTime() < 60 * 60 * 1000;
      const pick = list.find((x) => x.status === "rendering") ?? (list[0] && recent(list[0]) ? list[0] : undefined);
      if (pick) setPlan(pick.plan);
      return pick ?? null;
    });
    setMusic((r.j.music as string) ?? null);
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (r: ReelRow) => {
    setCurrent(r);
    setPlan(r.plan);
    setDirty(false);
    setMsg(null);
    setComposedAt(null);
  };

  // Poll a rendering reel
  useEffect(() => {
    if (current?.status !== "rendering") return;
    const t = setInterval(async () => {
      const r = await call({ action: "status", reelId: current.id });
      if (!r.ok) return;
      const reel = r.j.reel as ReelRow;
      setProgress((r.j.progress as string) ?? null);
      if (reel.status !== "rendering") {
        setCurrent(reel);
        setProgress(null);
        load();
        refresh();
        if (reel.status === "done") setMsg(r.j.copied === false ? "Film ready. It was too big to copy to your storage, so it's linked from the renderer. Download it soon." : "Film ready and published to Highlights.");
        if (reel.status === "failed") setMsg(`The film didn't render. ${reel.error ?? ""}`.trim());
        document.getElementById("film-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 5000);
    return () => clearInterval(t);
  }, [current?.status, current?.id, call, load, refresh]);

  // Poll pending Veo shots
  useEffect(() => {
    if (!current || !plan?.segments.some((s) => s.kind === "veo" && s.status === "pending")) return;
    const t = setInterval(async () => {
      for (const s of plan.segments.filter((x) => x.kind === "veo" && x.status === "pending")) {
        const r = await call({ action: "veoPoll", reelId: current.id, segmentId: s.id });
        if (r.ok) updateSeg(s.id, r.j.segment as Segment, false);
      }
    }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, plan]);

  function updateSeg(id: string, next: Segment, markDirty = true) {
    setPlan((p) => (p ? { ...p, segments: p.segments.map((s) => (s.id === id ? next : s)) } : p));
    if (markDirty) setDirty(true);
  }
  function move(i: number, d: -1 | 1) {
    setPlan((p) => {
      if (!p) return p;
      const segs = [...p.segments];
      const j = i + d;
      if (j < 0 || j >= segs.length) return p;
      [segs[i], segs[j]] = [segs[j], segs[i]];
      return { ...p, segments: segs };
    });
    setDirty(true);
  }
  function remove(i: number) {
    setPlan((p) => (p ? { ...p, segments: p.segments.filter((_, k) => k !== i) } : p));
    setDirty(true);
  }

  async function writePlan() {
    setBusy("plan");
    setMsg("The director is watching the tape… (about 20–40 seconds)");
    const r = await call({ action: "plan", brief });
    setBusy(null);
    if (!r.ok) return setMsg(String(r.j.error ?? "Couldn't write the plan"));
    open(r.j.reel as ReelRow);
    setMsg("Plan ready. Check it over, then render.");
    load();
  }

  async function save(): Promise<boolean> {
    if (!current || !plan) return false;
    setBusy("save");
    const r = await call({ action: "save", reelId: current.id, plan });
    setBusy(null);
    if (!r.ok) {
      setMsg(String(r.j.error ?? "Didn't save"));
      return false;
    }
    setPlan(r.j.plan as Plan);
    setDirty(false);
    setMsg("Saved");
    return true;
  }

  async function render() {
    if (!current) return;
    if (dirty && !(await save())) return;
    setBusy("render");
    setMsg(plan?.voiceOn ? "Recording the voice-over and sending the edit to the renderer…" : "Sending the edit to the renderer…");
    const r = await call({ action: "render", reelId: current.id });
    setBusy(null);
    if (!r.ok) return setMsg(String(r.j.error ?? "Render failed"));
    setMsg(`${r.j.warning ? `${r.j.warning} ` : ""}Rendering. Usually a minute or two. You can leave this page; it carries on.`);
    setCurrent({ ...current, status: "rendering" });
  }

  async function startVeo(id: string) {
    if (!current) return;
    if (dirty && !(await save())) return;
    const r = await call({ action: "veoStart", reelId: current.id, segmentId: id });
    if (!r.ok) return setMsg(String(r.j.error ?? "Couldn't start the shot"));
    updateSeg(id, r.j.segment as Segment, false);
  }

  async function uploadMusic(file: File) {
    setBusy("music");
    const up = await api("/api/upload-url", { filename: file.name, contentType: file.type || "audio/mpeg" });
    if (!up.ok) {
      setBusy(null);
      return setMsg(String(up.j.error ?? "Upload failed"));
    }
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", file);
    const put = await fetch(String(up.j.signedUrl), { method: "PUT", body: fd, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "false" } });
    if (!put.ok) {
      setBusy(null);
      return setMsg("Music upload failed");
    }
    await call({ action: "setMusic", path: up.j.path });
    setBusy(null);
    setMsg("Music saved for this tournament");
    load();
  }

  function setMusicChoice(next: Partial<PlanMusic>) {
    if (!plan) return;
    const cur: PlanMusic = plan.music ?? { source: "upload", mood: "epic" };
    const changedMood = next.mood && next.mood !== cur.mood;
    setPlan({ ...plan, music: { ...cur, ...next, ...(changedMood ? { src: undefined, seconds: undefined } : {}) } });
    setDirty(true);
  }

  async function compose() {
    if (!current || !plan) return;
    if (dirty && !(await save())) return;
    setBusy("compose");
    setMsg("Composing the music to fit the film. About a minute.");
    const r = await call({ action: "composeMusic", reelId: current.id });
    setBusy(null);
    if (!r.ok) return setMsg(String(r.j.error ?? "Music didn't compose"));
    setPlan((p) => (p ? { ...p, music: r.j.music as PlanMusic } : p));
    setComposedAt(plan ? planSeconds(plan) : null);
    setMsg("Music ready. Have a listen.");
  }

  function addClip(postId: string) {
    const p = state?.posts.find((x) => x.id === postId);
    if (!p || !plan) return;
    const r = state?.rounds.find((x) => x.id === p.round_id);
    const seg: Segment = {
      id: Math.random().toString(36).slice(2, 10),
      kind: "clip",
      postId: p.id,
      src: mediaUrl(p.media_path)!,
      caption: (p.player_ids ?? []).length
        ? (p.player_ids ?? []).map((id) => state?.players.find((x) => x.id === id)?.name ?? id).join(" & ")
        : `Hole ${p.hole ?? "–"} · ${p.author_name}`,
      sub: p.body?.slice(0, 50) ?? undefined,
      in: 0,
      out: null,
      round: r?.number ?? null,
      hole: p.hole,
      playerIds: p.player_ids ?? [],
      bug: true,
      finishes: p.tags.some((t) => TAGS_FINISH.includes(t)),
    };
    const lastCard = plan.segments.map((s) => s.kind === "card" && s.card === "standings").lastIndexOf(true);
    const at = lastCard >= 0 ? lastCard : plan.segments.length;
    setPlan({ ...plan, segments: [...plan.segments.slice(0, at), seg, ...plan.segments.slice(at)] });
    setDirty(true);
  }

  function addVeo() {
    if (!plan) return;
    setPlan({
      ...plan,
      segments: [
        { id: Math.random().toString(36).slice(2, 10), kind: "veo", prompt: "Slow aerial glide over a misty parkland fairway at dawn, dew on the grass, a flag stirring on a distant green", seconds: 6, status: "idle" },
        ...plan.segments,
      ],
    });
    setDirty(true);
  }

  if (!state || !cfg) return <p className="muted">Loading…</p>;
  const unused = state.posts.filter((p) => p.kind === "video" && p.media_path && !(p.body ?? "").startsWith("Highlights reel") && !plan?.segments.some((s) => s.kind === "clip" && s.postId === p.id));
  const total = plan ? planSeconds(plan) : 0;
  const locked = current?.status === "rendering";

  return (
    <section className="panel stack">
      <h2>AI director</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Claude picks and orders your clips, writes captions and narration, and the film is rendered with your theme, music and an optional voice-over. Every score on screen comes from the scoreboard, not the AI.
      </p>
      <div className="row small display">
        <Status ok={cfg.claude} label="Plan writer" />
        <Status ok={cfg.shotstack} label={`Renderer${cfg.shotstack && cfg.shotstackEnv === "stage" ? " (test mode, watermarked)" : ""}`} />
        <Status ok={cfg.voice} label="Voice-over" />
        <Status ok={cfg.veo} label="Veo shots" />
      </div>

      {/* brief */}
      <div className="post stack">
        <h3>New film</h3>
        <div className="row">
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="dir-scope">Which part</label>
            <select id="dir-scope" value={brief.roundNumber ?? ""} onChange={(e) => setBrief({ ...brief, roundNumber: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Whole tournament</option>
              {state.rounds.map((r) => (
                <option key={r.id} value={r.number}>
                  R{r.number} {r.course_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 130px" }}>
            <label htmlFor="dir-length">Length</label>
            <select id="dir-length" value={brief.length} onChange={(e) => setBrief({ ...brief, length: Number(e.target.value) as Brief["length"] })}>
              <option value={60}>About 1 minute</option>
              <option value={180}>About 3 minutes</option>
              <option value={300}>About 5 minutes</option>
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 150px" }}>
            <label htmlFor="dir-shape">Shape</label>
            <select id="dir-shape" value={brief.aspect} onChange={(e) => setBrief({ ...brief, aspect: e.target.value as Brief["aspect"] })}>
              <option value="16:9">Landscape (TV, laptop)</option>
              <option value="9:16">Portrait (phones, stories)</option>
            </select>
          </div>
        </div>
        <div className="row">
          <label className="row display">
            <input type="checkbox" checked={brief.voice && cfg.voice} disabled={!cfg.voice} onChange={(e) => setBrief({ ...brief, voice: e.target.checked })} style={{ width: 20, height: 20 }} />
            AI voice-over
          </label>
          <label className="row display">
            <input type="checkbox" checked={brief.veo && cfg.veo} disabled={!cfg.veo} onChange={(e) => setBrief({ ...brief, veo: e.target.checked })} style={{ width: 20, height: 20 }} />
            Suggest cinematic AI shots
          </label>
        </div>
        <div className="row">
          <button className="btn" disabled={!!busy || !cfg.claude} onClick={writePlan}>
            {busy === "plan" ? "Writing the plan…" : "Write the plan"}
          </button>
        </div>
      </div>

      {msg && (
        <p className="display" aria-live="polite" style={{ margin: 0 }}>
          {msg}
          {progress ? ` (${progress})` : ""}
        </p>
      )}

      {/* plan editor */}
      {current && plan && (
        <div className="stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>
              Edit plan · {fmtTime(total)} · {plan.aspect === "9:16" ? "portrait" : "landscape"}
            </h3>
            <span className={`pill ${current.status === "done" ? "done" : current.status === "rendering" ? "live" : ""}`}>{current.status}</span>
          </div>
          <FilmResult reel={current} progress={progress} highlights={href("/highlights")} />
          <div className="row">
            <div className="field" style={{ flex: "2 1 220px" }}>
              <label htmlFor="dir-title">Film title</label>
              <input id="dir-title" value={plan.title} disabled={locked} onChange={(e) => (setPlan({ ...plan, title: e.target.value }), setDirty(true))} />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label htmlFor="dir-musicvol">Music volume</label>
              <input id="dir-musicvol" type="range" min={0} max={1} step={0.05} value={plan.musicVolume} disabled={locked} onChange={(e) => (setPlan({ ...plan, musicVolume: Number(e.target.value) }), setDirty(true))} />
            </div>
            <label className="row display" style={{ flex: "1 1 160px" }}>
              <input type="checkbox" checked={plan.voiceOn} disabled={locked || !cfg.voice} onChange={(e) => (setPlan({ ...plan, voiceOn: e.target.checked }), setDirty(true))} style={{ width: 20, height: 20 }} />
              Voice-over on
            </label>
          </div>

          <MusicChoice
            music={plan.music ?? { source: "upload", mood: "epic" }}
            fits={composedAt != null ? Math.abs(composedAt - total) <= 2 : musicFits(plan.music, total)}
            uploaded={music}
            canCompose={cfg.voice}
            locked={locked}
            busy={busy}
            onChange={setMusicChoice}
            onCompose={compose}
            onUpload={uploadMusic}
          />

          <ol className="director-list">
            {plan.segments.map((s, i) => (
              <li key={s.id} className="post stack">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="display" style={{ fontWeight: 700 }}>
                    {i + 1}.{" "}
                    {s.kind === "card"
                      ? { title: "Title card", chapter: "Chapter card", result: "Round result", standings: "Standings" }[s.card]
                      : s.kind === "clip"
                        ? `Clip · R${s.round ?? "–"} H${s.hole ?? "–"}`
                        : "AI shot (Veo)"}{" "}
                    <span className="muted small">· {segmentSeconds(s).toFixed(1)}s</span>
                  </span>
                  {!locked && (
                    <span className="row" style={{ gap: 4 }}>
                      <button className="chip" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button className="chip" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === plan.segments.length - 1}>
                        ↓
                      </button>
                      <button className="chip" onClick={() => remove(i)}>
                        Remove
                      </button>
                    </span>
                  )}
                </div>

                {s.kind === "card" && (
                  <div className="row">
                    <input value={s.eyebrow ?? ""} placeholder="Small line above" disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, eyebrow: e.target.value })} style={{ flex: "1 1 160px" }} />
                    <input value={s.heading} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, heading: e.target.value })} style={{ flex: "2 1 200px" }} aria-label="Heading" />
                    <input value={s.sub ?? ""} placeholder="Sub line" disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, sub: e.target.value })} style={{ flex: "2 1 200px" }} />
                    <input type="number" min={1} max={15} value={s.seconds} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, seconds: Number(e.target.value) || 3 })} style={{ width: 80 }} aria-label="Seconds" />
                    {s.rows && (
                      <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                        From the scoreboard: {s.rows.map(([a, b]) => `${a} ${b}`).join(" · ")}
                      </p>
                    )}
                  </div>
                )}

                {s.kind === "clip" && (
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <video
                      src={s.src}
                      preload="metadata"
                      controls
                      playsInline
                      style={{ width: 180, maxHeight: 120, background: "#000", borderRadius: 6 }}
                      onLoadedMetadata={(e) => {
                        const d = Math.round((e.target as HTMLVideoElement).duration * 10) / 10;
                        if (Number.isFinite(d) && d !== s.duration) updateSeg(s.id, { ...s, duration: d }, false);
                      }}
                    />
                    <div className="stack" style={{ flex: "1 1 220px" }}>
                      <input value={s.caption} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, caption: e.target.value })} aria-label="Caption" />
                      <input value={s.sub ?? ""} placeholder="Sub line" disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, sub: e.target.value })} />
                      <div className="row small">
                        <label className="row">
                          From
                          <input type="number" step={0.5} min={0} value={s.in} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, in: Number(e.target.value) || 0 })} style={{ width: 80 }} />
                        </label>
                        <label className="row">
                          to
                          <input
                            type="number"
                            step={0.5}
                            min={0}
                            value={s.out ?? ""}
                            placeholder={s.duration ? String(Math.min(s.duration, s.in + 10)) : "end"}
                            disabled={locked}
                            onChange={(e) => updateSeg(s.id, { ...s, out: e.target.value === "" ? null : Number(e.target.value) })}
                            style={{ width: 80 }}
                          />
                        </label>
                        <span className="muted">{s.duration ? `clip is ${s.duration}s` : ""}</span>
                      </div>
                    </div>
                    <div className="stack" style={{ flexBasis: "100%" }}>
                      <div className="row small">
                        <label className="row">
                          Round
                          <select value={s.round ?? ""} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, round: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Round">
                            <option value="">–</option>
                            {state.rounds.map((r) => (
                              <option key={r.id} value={r.number}>
                                {r.number}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="row">
                          Hole
                          <select value={s.hole ?? ""} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, hole: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Hole">
                            <option value="">–</option>
                            {Array.from({ length: 18 }, (_, k) => (
                              <option key={k} value={k + 1}>
                                {k + 1}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="row">
                          <input type="checkbox" checked={s.bug !== false} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, bug: e.target.checked })} style={{ width: 18, height: 18 }} />
                          Score panel
                        </label>
                        <label className="row">
                          <input type="checkbox" checked={!!s.finishes} disabled={locked || s.bug === false} onChange={(e) => updateSeg(s.id, { ...s, finishes: e.target.checked })} style={{ width: 18, height: 18 }} />
                          Finishes the hole
                        </label>
                      </div>
                      {s.bug !== false && bugs[s.id] && (
                        <div className="row" style={{ alignItems: "flex-start" }}>
                          <PanelImg src={bugs[s.id].beforeUrl} portrait={plan.aspect === "9:16"} alt="Score panel during the clip" />
                          {bugs[s.id].afterUrl && <PanelImg src={bugs[s.id].afterUrl!} portrait={plan.aspect === "9:16"} alt="Score panel after the hole" />}
                          <pre className="small bug-text" style={{ whiteSpace: "pre-wrap", margin: 0, flex: "1 1 200px", fontFamily: "inherit" }}>
                            {bugText(bugs[s.id].before)}
                            {bugs[s.id].after ? `\nThen: ${bugText(bugs[s.id].after).split("\n").slice(1).join(" · ")}` : s.finishes ? "\n(This hole isn't scored yet, so the panel won't update.)" : ""}
                          </pre>
                        </div>
                      )}
                      {s.bug !== false && (s.round == null || s.hole == null) && <span className="small muted">Set the round and hole to show the score panel.</span>}
                    </div>
                  </div>
                )}

                {s.kind === "veo" && (
                  <div className="stack">
                    <textarea value={s.prompt} disabled={locked || s.status === "pending"} onChange={(e) => updateSeg(s.id, { ...s, prompt: e.target.value, status: s.status === "done" ? "idle" : s.status })} style={{ minHeight: 120 }} aria-label="Shot description" />
                    <div className="row">
                      <select value={s.seconds} disabled={locked || s.status === "pending"} onChange={(e) => updateSeg(s.id, { ...s, seconds: Number(e.target.value) as 4 | 6 | 8 })}>
                        <option value={4}>4 seconds</option>
                        <option value={6}>6 seconds</option>
                        <option value={8}>8 seconds</option>
                      </select>
                      {s.status !== "pending" && !locked && (
                        <button className="btn secondary" disabled={!cfg.veo} onClick={() => startVeo(s.id)}>
                          {s.status === "done" ? "Make it again" : "Generate this shot"}
                        </button>
                      )}
                      <span className="small display">
                        {s.status === "pending" ? "Generating (1–5 minutes)…" : s.status === "failed" ? <span className="error">{s.error}</span> : s.status === "idle" ? "Not generated yet (skipped in the film until it is)" : ""}
                      </span>
                    </div>
                    {s.status === "done" && s.src && <video src={s.src} controls playsInline style={{ width: 240, background: "#000", borderRadius: 6 }} />}
                  </div>
                )}

                {plan.voiceOn && (
                  <div className="field">
                    <label className="small">
                      Narration{" "}
                      {s.voice && voiceSeconds(s.voice) > segmentSeconds(s) + 0.5 && s.kind !== "card" && (
                        <span className="error">· too long for this clip ({voiceSeconds(s.voice).toFixed(1)}s)</span>
                      )}
                    </label>
                    <textarea value={s.voice ?? ""} disabled={locked} onChange={(e) => updateSeg(s.id, { ...s, voice: e.target.value })} style={{ minHeight: 44 }} />
                  </div>
                )}
              </li>
            ))}
          </ol>

          {!locked && (
            <div className="row">
              {unused.length > 0 && (
                <select value="" onChange={(e) => e.target.value && addClip(e.target.value)} aria-label="Add a clip" style={{ maxWidth: 320 }}>
                  <option value="">Add a clip…</option>
                  {unused.map((p) => {
                    const r = state.rounds.find((x) => x.id === p.round_id);
                    return (
                      <option key={p.id} value={p.id}>
                        {r ? `R${r.number} ` : ""}H{p.hole ?? "–"} · {p.author_name} {p.body ? `· ${p.body.slice(0, 30)}` : ""}
                      </option>
                    );
                  })}
                </select>
              )}
              {cfg.veo && (
                <button className="chip" onClick={addVeo}>
                  Add an AI shot
                </button>
              )}
            </div>
          )}

          <div className="row">
            {!locked && (
              <button className="btn secondary" disabled={!dirty || !!busy} onClick={save}>
                Save changes
              </button>
            )}
            {!locked && (
              <button className="btn" disabled={!!busy || !cfg.shotstack} onClick={render}>
                {busy === "render" ? "Starting…" : current.status === "done" ? "Render again" : "Render the film"}
              </button>
            )}
          </div>
        </div>
      )}

      {reels.length > 0 && (
        <div className="stack">
          <h3>Your films</h3>
          {reels.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
              <button className="chip" aria-pressed={current?.id === r.id} onClick={() => open(r)}>
                {r.plan?.title ?? "Untitled"} · {new Date(r.created_at).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </button>
              <span className={`pill ${r.status === "done" ? "done" : r.status === "rendering" ? "live" : ""}`}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="pill" style={{ background: ok ? "var(--board)" : "var(--mist)", color: ok ? "var(--tile)" : "var(--ink-soft)" }} title={ok ? "Connected" : "Not set up yet (add its key in Vercel)"}>
      {ok ? "✓" : "–"} {label}
    </span>
  );
}


/** Music for this film: composed to fit (default), the tournament's own track, or none. */
function MusicChoice({
  music,
  fits,
  uploaded,
  canCompose,
  locked,
  busy,
  onChange,
  onCompose,
  onUpload,
}: {
  music: PlanMusic;
  fits: boolean;
  uploaded: string | null;
  canCompose: boolean;
  locked: boolean;
  busy: string | null;
  onChange: (m: Partial<PlanMusic>) => void;
  onCompose: () => void;
  onUpload: (f: File) => void;
}) {
  return (
    <div className="post stack music-choice">
      <div className="row">
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor="dir-music">Music</label>
          <select id="dir-music" value={music.source} disabled={locked} onChange={(e) => onChange({ source: e.target.value as PlanMusic["source"] })}>
            {canCompose && <option value="made">Made for this film</option>}
            <option value="upload">Your own track</option>
            <option value="none">No music</option>
          </select>
        </div>
        {music.source === "made" && (
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor="dir-mood">Mood</label>
            <select id="dir-mood" value={music.mood} disabled={locked} onChange={(e) => onChange({ mood: e.target.value as Mood })}>
              {MOODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {music.source === "made" && (
        <div className="row">
          {music.src && <audio key={music.src} src={music.src} controls style={{ height: 36, maxWidth: 300 }} />}
          <button className="btn secondary" disabled={locked || !!busy} onClick={onCompose}>
            {busy === "compose" ? "Composing…" : music.src ? "Try another" : "Compose music"}
          </button>
          <span className="small muted">
            {!music.src
              ? "Composed to the film's exact length. Or just render, and it's made then."
              : fits
                ? "Fits the film as it stands."
                : "The film's length has changed, so new music will be composed when you render."}
          </span>
        </div>
      )}

      {music.source === "upload" && (
        <div className="row">
          {uploaded ? <audio src={uploaded} controls style={{ height: 36, maxWidth: 300 }} /> : <span className="small muted">No track yet. Use a royalty-free one, at least as long as the film.</span>}
          <label className="btn secondary" style={{ cursor: "pointer" }}>
            {busy === "music" ? "Uploading…" : uploaded ? "Replace track" : "Upload a track"}
            <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </label>
        </div>
      )}
    </div>
  );
}

/** Where the film is: rendering, ready (with the film itself), or failed (with the reason). */
function FilmResult({ reel, progress, highlights }: { reel: ReelRow; progress: string | null; highlights: string }) {
  if (reel.status === "rendering")
    return (
      <div id="film-result" className="film-result is-rendering" role="status">
        <strong>Rendering your film</strong>
        <span>
          Usually 2 to 5 minutes{progress ? ` (${progress})` : ""}. You can leave this page; the film is saved to Highlights when it&apos;s done.
        </span>
      </div>
    );
  if (reel.status === "failed")
    return (
      <div id="film-result" className="film-result is-failed" role="alert">
        <strong>The film didn&apos;t render</strong>
        <span>{reel.error ?? "The renderer gave no reason."}</span>
        <span>Fix anything it mentions and press Render again. If it happens again, copy the message above for help.</span>
      </div>
    );
  if (reel.status === "done" && reel.video_path)
    return (
      <div id="film-result" className="film-result is-done">
        <strong>Your film is ready</strong>
        <span>It&apos;s on the Highlights page for everyone following the trip.</span>
        <video src={mediaUrl(reel.video_path)!} controls playsInline />
        <div className="row">
          <a className="btn secondary" href={mediaUrl(reel.video_path)!} download>
            Download
          </a>
          <Link className="btn secondary" href={highlights}>
            See it in Highlights
          </Link>
        </div>
      </div>
    );
  return null;
}
