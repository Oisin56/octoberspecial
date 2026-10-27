"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loading, PageHead, Problem, day, n } from "@/components/console/kit";
import { CAMPAIGN_STATUS, EmailTabs, Preview, eact, statsLine, useEmailView, type Stats } from "@/components/console/email";

type Block =
  | { type: "headline"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "photo"; photo: string; alt: string; href?: string }
  | { type: "button"; label: string; href: string }
  | { type: "film"; reel: string }
  | { type: "quote"; text: string; by: string };

interface Audience {
  roles: string[];
  active: string;
  trips: string;
}
interface Campaign {
  id: string;
  name: string;
  subject: string;
  blocks: Block[];
  audience: Partial<Audience>;
  status: string;
  send_on: string | null;
  started_at: string | null;
  finished_at: string | null;
  planned: number | null;
  sent_by: string | null;
  note: string | null;
  created_by: string;
}
interface Count {
  total: number;
  ready: number;
  held: number;
}
interface Data {
  campaign: Campaign;
  stats: Stats;
  count: Count | null;
  photos: { id: string; name: string | null; src: string }[];
  films: { id: string; title: string }[];
  role: "owner" | "support";
  today: string;
}

const KINDS: [Block["type"], string][] = [
  ["headline", "Headline"],
  ["paragraph", "Paragraph"],
  ["photo", "Photo"],
  ["button", "Button"],
  ["film", "Film"],
  ["quote", "Quote"],
];
const ROLES: [string, string][] = [
  ["organiser", "Organisers"],
  ["player", "Players"],
  ["follower", "Followers"],
  ["subscriber", "Signed up for updates"],
];

const fresh = (t: Block["type"]): Block =>
  t === "headline" ? { type: t, text: "" } : t === "paragraph" ? { type: t, text: "" } : t === "photo" ? { type: t, photo: "", alt: "" } : t === "button" ? { type: t, label: "", href: "https://mygolfbroadcast.com" } : t === "film" ? { type: t, reel: "" } : { type: t, text: "", by: "" };

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, err, reload } = useEmailView<Data>("campaign", { id });
  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;
  return <Editor key={`${data.campaign.status}:${data.campaign.send_on}`} data={data} reload={reload} />;
}

function Editor({ data, reload }: { data: Data; reload: () => void }) {
  const router = useRouter();
  const c = data.campaign;
  const owner = data.role === "owner";
  const draft = c.status === "draft";
  const [name, setName] = useState(c.name);
  const [subject, setSubject] = useState(c.subject);
  const [blocks, setBlocks] = useState<Block[]>(c.blocks ?? []);
  const [aud, setAud] = useState<Audience>({ roles: c.audience?.roles ?? [], active: c.audience?.active ?? "", trips: c.audience?.trips ?? "" });
  const [count, setCount] = useState<Count | null>(data.count);
  const [photos, setPhotos] = useState(data.photos);
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const [perr, setPerr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState("");
  const [go, setGo] = useState<null | "now" | "later">(null);
  const [when, setWhen] = useState(data.today);
  const [typed, setTyped] = useState("");
  const [sureDelete, setSureDelete] = useState(false);
  const first = useRef(true);
  const seq = useRef(0);

  // Saved as you go (a draft only)
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!draft) return;
    const t = setTimeout(async () => {
      const r = await eact({ action: "campaign.save", id: c.id, name, subject, blocks, audience: aud });
      setSaved(r.ok ? "Saved" : String(r.j.error ?? "Not saved"));
    }, 900);
    return () => clearTimeout(t);
  }, [name, subject, blocks, aud, draft, c.id]);

  // The preview, with the first person it would go to
  useEffect(() => {
    const k = ++seq.current;
    const t = setTimeout(async () => {
      const r = await eact<{ html: string; subject: string }>({ action: "preview", key: "campaign", subject, blocks, audience: aud });
      if (k !== seq.current) return;
      if (r.ok) {
        setPreview(r.j);
        setPerr(null);
      } else setPerr(String(r.j.error ?? "The preview didn't load"));
    }, 400);
    return () => clearTimeout(t);
  }, [subject, blocks, aud]);

  // Who it would go to
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(async () => {
      const r = await eact<Count>({ action: "campaign.count", audience: aud });
      if (r.ok) setCount(r.j);
    }, 400);
    return () => clearTimeout(t);
  }, [aud, draft]);

  const run = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    const r = await eact(body);
    setBusy(false);
    setMsg(r.ok ? { text: ok } : { text: String(r.j.error ?? "That didn't work"), bad: true });
    return r;
  };
  const set = (i: number, b: Block) => setBlocks(blocks.map((x, k) => (k === i ? b : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };

  async function upload(file: File, i: number, b: Extract<Block, { type: "photo" }>) {
    if (file.size > 3 * 1024 * 1024) return setMsg({ text: "That photo is too big. 3 MB at most.", bad: true });
    const data64 = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    setBusy(true);
    const r = await eact<{ id: string; photos: Data["photos"] }>({ action: "photo", data: data64, name: file.name });
    setBusy(false);
    if (!r.ok) return setMsg({ text: String(r.j.error ?? "That photo didn't upload"), bad: true });
    setPhotos(r.j.photos);
    set(i, { ...b, photo: r.j.id });
  }

  const big = (count?.total ?? 0) > 500;
  return (
    <>
      <p className="con-crumb">
        <Link href="/console/email/campaigns">Campaigns</Link>
      </p>
      <PageHead title={c.name} lead={<>{CAMPAIGN_STATUS[c.status] ?? c.status}{c.status === "scheduled" && c.send_on ? `, for ${day(c.send_on)} at 10am` : ""}{c.started_at ? `, started ${day(c.started_at)}` : ""}{c.sent_by ? ` by ${c.sent_by}` : ""}</>} />
      <EmailTabs />

      {!draft && (
        <section className="con-panel" aria-labelledby="h-how">
          <h2 id="h-how">How it went</h2>
          <p className="con-big-line" style={{ marginTop: 0 }}>
            {statsLine(data.stats)}
            {c.planned ? `. It was for ${n(c.planned)} people.` : ""}
          </p>
          {c.note && <p className="con-warn">{c.note}</p>}
          <div className="em-acts">
            {c.status === "paused" && owner && (
              <button className="btn" disabled={busy} onClick={async () => (await run({ action: "campaign.resume", id: c.id }, "Carrying on.")).ok && reload()}>
                Carry on sending
              </button>
            )}
            {c.status === "scheduled" && owner && (
              <button className="btn secondary" disabled={busy} onClick={async () => (await run({ action: "campaign.unschedule", id: c.id }, "Off the schedule. It's a draft again.")).ok && reload()}>
                Take it off the schedule
              </button>
            )}
            {owner && ["sending", "paused", "scheduled"].includes(c.status) && (
              <button className="btn secondary con-danger" disabled={busy} onClick={async () => (await run({ action: "campaign.stop", id: c.id }, "Stopped. Nothing more goes.")).ok && reload()}>
                Stop it
              </button>
            )}
            <button
              className="btn secondary"
              disabled={busy}
              onClick={async () => {
                const r = await run({ action: "campaign.copy", id: c.id }, "Copied.");
                if (r.ok && r.j.id) router.push(`/console/email/campaigns/${r.j.id}`);
              }}
            >
              Make a copy
            </button>
            {c.status === "sending" && (
              <button className="btn secondary" onClick={reload}>
                Refresh the figures
              </button>
            )}
          </div>
          {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
        </section>
      )}

      <div className="em-edit">
        <div className="em-fields">
          {draft && (
            <details className="con-panel" style={{ margin: 0 }}>
              <summary>
                <strong>Draft it for me</strong>
              </summary>
              <p className="small">Say what it&apos;s about and anything it must include. You get a first draft in the house style, using only what you said. It replaces anything written below. Read it and change it before it goes.</p>
              <div className="field">
                <label htmlFor="brief">What&apos;s it about?</label>
                <textarea id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Spring offer: 20% off a highlights film, ends 30 April" />
              </div>
              <button
                className="btn secondary"
                disabled={busy || brief.trim().length < 8}
                onClick={async () => {
                  setBusy(true);
                  const r = await eact<{ subject: string; blocks: Block[] }>({ action: "campaign.draft", brief });
                  setBusy(false);
                  if (!r.ok) return setMsg({ text: String(r.j.error ?? "The draft didn't come back"), bad: true });
                  setSubject(r.j.subject);
                  setBlocks(r.j.blocks);
                  setMsg({ text: "Here's a first draft. Read every word, and set where the button goes." });
                }}
              >
                {busy ? "Writing…" : "Write a draft"}
              </button>
            </details>
          )}

          <div className="field">
            <label htmlFor="c-name">Its name (only you see this)</label>
            <input id="c-name" value={name} readOnly={!draft} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="c-subject">Subject</label>
            <input id="c-subject" value={subject} readOnly={!draft} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
          </div>
          <p className="em-places">
            It can fill in <code>{"{first name}"}</code> <code>{"{tournament}"}</code> (their most recent). With no first name on file, &quot;Hi {"{first name}"},&quot; reads &quot;Hi,&quot;.
          </p>

          <ul className="em-blocks">
            {blocks.map((b, i) => (
              <li key={i} className="em-block">
                <div className="em-block-head">
                  <span>{KINDS.find(([k]) => k === b.type)?.[1]}</span>
                  {draft && (
                    <div>
                      <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === blocks.length - 1}>
                        ↓
                      </button>
                      <button type="button" onClick={() => setBlocks(blocks.filter((_, k) => k !== i))}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
                {b.type === "headline" && <input aria-label="Headline" value={b.text} readOnly={!draft} onChange={(e) => set(i, { ...b, text: e.target.value })} maxLength={150} />}
                {b.type === "paragraph" && <textarea aria-label="Paragraph" value={b.text} readOnly={!draft} onChange={(e) => set(i, { ...b, text: e.target.value })} />}
                {b.type === "quote" && (
                  <>
                    <textarea aria-label="The quote" value={b.text} readOnly={!draft} onChange={(e) => set(i, { ...b, text: e.target.value })} placeholder="Only words someone has said you can use" />
                    <input aria-label="Who said it" value={b.by} readOnly={!draft} onChange={(e) => set(i, { ...b, by: e.target.value })} placeholder="Who said it" />
                  </>
                )}
                {b.type === "button" && (
                  <>
                    <input aria-label="Button words" value={b.label} readOnly={!draft} onChange={(e) => set(i, { ...b, label: e.target.value })} maxLength={40} placeholder="Button words" />
                    <input aria-label="Where it goes" value={b.href} readOnly={!draft} onChange={(e) => set(i, { ...b, href: e.target.value })} placeholder="https://… or /new" />
                  </>
                )}
                {b.type === "film" && (
                  <select aria-label="Which film" value={b.reel} disabled={!draft} onChange={(e) => set(i, { ...b, reel: e.target.value })}>
                    <option value="">Choose a film</option>
                    {data.films.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </select>
                )}
                {b.type === "photo" && (
                  <>
                    {photos.length > 0 && (
                      <div className="em-photos" role="group" aria-label="Photos kept for emails">
                        {photos.map((p) => (
                          <button key={p.id} type="button" aria-pressed={b.photo === p.id} aria-label={p.name ?? "Photo"} disabled={!draft} onClick={() => set(i, { ...b, photo: p.id })}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.src} alt="" />
                          </button>
                        ))}
                      </div>
                    )}
                    {draft && (
                      <label className="btn secondary" style={{ justifySelf: "start" }}>
                        Upload a photo
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], i, b)} />
                      </label>
                    )}
                    <input aria-label="What's in the photo" value={b.alt} readOnly={!draft} onChange={(e) => set(i, { ...b, alt: e.target.value })} placeholder="What's in the photo, for people who can't see it" />
                  </>
                )}
              </li>
            ))}
          </ul>
          {draft && (
            <div className="em-add" role="group" aria-label="Add">
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" className="btn secondary" onClick={() => setBlocks([...blocks, fresh(k)])}>
                  Add {label.toLowerCase()}
                </button>
              ))}
            </div>
          )}

          <fieldset className="con-panel" style={{ margin: 0 }} disabled={!draft}>
            <legend className="sr-only">Who gets it</legend>
            <h2 style={{ marginTop: 0 }}>Who gets it</h2>
            <p className="small" style={{ marginTop: 0 }}>
              Only people who ticked the marketing box, with news and offers on. Leave everything unticked for all of them.
            </p>
            <div className="em-roles">
              {ROLES.map(([r, label]) => (
                <label key={r}>
                  <input type="checkbox" checked={aud.roles.includes(r)} onChange={(e) => setAud({ ...aud, roles: e.target.checked ? [...aud.roles, r] : aud.roles.filter((x) => x !== r) })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="con-form-row">
              <div className="field">
                <label htmlFor="a-active">Last took part</label>
                <select id="a-active" value={aud.active} onChange={(e) => setAud({ ...aud, active: e.target.value })}>
                  <option value="">Any time</option>
                  <option value="30">In the last 30 days</option>
                  <option value="90">In the last 3 months</option>
                  <option value="365">In the last year</option>
                  <option value="idle">Not for a year or more</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="a-trips">Trips</label>
                <select id="a-trips" value={aud.trips} onChange={(e) => setAud({ ...aud, trips: e.target.value })}>
                  <option value="">Any number</option>
                  <option value="1">Just one</option>
                  <option value="2">Two or more</option>
                </select>
              </div>
            </div>
            {count && (
              <p className="em-count" style={{ marginTop: 12 }}>
                {n(count.total)} {count.total === 1 ? "person" : "people"}
                <small>{count.held > 0 ? `${n(count.ready)} would get it today. ${n(count.held)} had an email from us this week or are on a trip, and are left out.` : "All of them would get it today."}</small>
              </p>
            )}
          </fieldset>

          <div className="em-acts">
            <button className="btn secondary" disabled={busy} onClick={() => run({ action: "test", key: "campaign", subject, blocks, audience: aud }, "Sent to your email, marked Test.")}>
              Send me a test
            </button>
            {draft && <span className="small con-quiet">{saved ?? ""}</span>}
          </div>

          {draft &&
            (owner ? (
              <section className="con-panel" style={{ margin: 0 }} aria-labelledby="h-go">
                <h2 id="h-go" style={{ marginTop: 0 }}>
                  Send it
                </h2>
                {!go ? (
                  <div className="em-acts">
                    <button className="btn" disabled={busy || !count?.total} onClick={() => setGo("now")}>
                      Send now
                    </button>
                    <button className="btn secondary" disabled={busy || !count?.total} onClick={() => setGo("later")}>
                      Schedule it for a day
                    </button>
                  </div>
                ) : (
                  <div className="con-confirm">
                    <p>
                      <strong>{name}</strong>: &quot;{subject || "no subject yet"}&quot; to {n(count?.ready ?? 0)} people {go === "now" ? "now" : "at 10am on the day"}, in batches. Anyone who&apos;s had a marketing email this week, or is on a trip, is left out.
                    </p>
                    {go === "later" && (
                      <div className="field" style={{ marginTop: 10 }}>
                        <label htmlFor="c-when">The day</label>
                        <input id="c-when" type="date" min={data.today} value={when} onChange={(e) => setWhen(e.target.value)} />
                      </div>
                    )}
                    {big && (
                      <div className="field" style={{ marginTop: 10 }}>
                        <label htmlFor="c-typed">It&apos;s a big one: type {count?.total} to confirm</label>
                        <input id="c-typed" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} />
                      </div>
                    )}
                    <div className="em-acts" style={{ marginTop: 10 }}>
                      <button
                        className="btn"
                        disabled={busy || (big && Number(typed) !== count?.total)}
                        onClick={async () => {
                          await eact({ action: "campaign.save", id: c.id, name, subject, blocks, audience: aud });
                          const r = await run(go === "now" ? { action: "campaign.send", id: c.id, confirm: Number(typed) } : { action: "campaign.schedule", id: c.id, send_on: when, confirm: Number(typed) }, go === "now" ? "Sending now." : "Scheduled.");
                          if (r.ok) reload();
                        }}
                      >
                        {go === "now" ? "Yes, send it now" : "Yes, schedule it"}
                      </button>
                      <button className="btn secondary" onClick={() => setGo(null)}>
                        Not yet
                      </button>
                    </div>
                  </div>
                )}
                {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
                <p style={{ marginTop: 14 }}>
                  {sureDelete ? (
                    <span className="em-acts">
                      <button
                        className="btn secondary con-danger"
                        onClick={async () => {
                          const r = await run({ action: "campaign.delete", id: c.id }, "Deleted.");
                          if (r.ok) router.push("/console/email/campaigns");
                        }}
                      >
                        Yes, delete this draft
                      </button>
                      <button className="btn secondary" onClick={() => setSureDelete(false)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button className="linklike" onClick={() => setSureDelete(true)}>
                      Delete this draft
                    </button>
                  )}
                </p>
              </section>
            ) : (
              <>
                <p className="con-note" style={{ margin: 0 }}>
                  Only the owner can send or schedule it. It&apos;s saved: tell them it&apos;s ready.
                </p>
                {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
              </>
            ))}
        </div>
        <Preview html={preview?.html ?? null} subject={preview?.subject} err={perr} />
      </div>
    </>
  );
}
