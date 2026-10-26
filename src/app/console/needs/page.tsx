"use client";

import { useState } from "react";
import Link from "next/link";
import { useConsole } from "@/components/console/Shell";
import { Loading, PageHead, Pager, Problem, Select, act, age, PersonLink, useFilters, useView, day } from "@/components/console/kit";
import type { NeedRow } from "@/lib/console-data";

type Btn = { action: string; label: string; owner?: boolean; primary?: boolean; resolution?: string };

/** The buttons each kind of item needs. */
const BUTTONS: Record<string, Btn[]> = {
  data_request: [
    { action: "needs.sendcopy", label: "Send their copy", owner: true, primary: true },
    { action: "needs.requestdone", label: "Mark done", owner: true },
  ],
  report: [
    { action: "needs.hide", label: "Hide it", primary: true },
    { action: "needs.keep", label: "Keep it" },
    { action: "needs.mute", label: "Stop them posting" },
  ],
  film: [
    { action: "needs.retry", label: "Try again", primary: true },
    { action: "needs.tell", label: "Tell the organiser" },
    { action: "needs.done", label: "Clear it", resolution: "Looked at" },
  ],
  invite: [
    { action: "needs.approve", label: "Approve", primary: true },
    { action: "needs.decline", label: "Decline" },
  ],
  spend: [{ action: "needs.done", label: "Leave it", resolution: "Left as it is" }],
  follow_wait: [
    { action: "needs.remind", label: "Remind them again", primary: true },
    { action: "needs.done", label: "Clear it", resolution: "Left to the organiser" },
  ],
  email_failing: [
    { action: "needs.block", label: "Stop emailing it", owner: true },
    { action: "needs.done", label: "Clear it", resolution: "Looked at" },
  ],
  research: [
    { action: "needs.research", label: "Try again", primary: true },
    { action: "needs.done", label: "Leave it", resolution: "Left without a guide" },
  ],
};

const KINDS: [string, string][] = [
  ["", "Everything"],
  ["data_request", "Data requests"],
  ["report", "Reported posts and comments"],
  ["film", "Films"],
  ["invite", "Invite requests"],
  ["spend", "Spending"],
  ["follow_wait", "Follow requests waiting"],
  ["email_failing", "Emails not getting through"],
  ["research", "Course research"],
];

export default function NeedsPage() {
  const { user, refreshNeeds } = useConsole();
  const { values, set } = useFilters(["kind", "snoozed", "mine", "page"]);
  const page = Number(values.page || 0);
  const { data, err, reload } = useView<{ items: NeedRow[]; total: number; snoozed: number }>("needs", { kind: values.kind, snoozed: values.snoozed, mine: values.mine, page });
  const staff = useView<{ staff: { email: string; removed_at: string | null }[]; ownerEmail: string | null }>("settings");
  const people = [staff.data?.ownerEmail, ...(staff.data?.staff ?? []).filter((s) => !s.removed_at).map((s) => s.email)].filter(Boolean) as string[];
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [msg, setMsg] = useState<{ id: string; text: string; bad?: boolean } | null>(null);

  async function run(i: NeedRow, body: Record<string, unknown>, done: string) {
    setBusy(`${i.id}:${body.action}`);
    setMsg(null);
    const r = await act({ ...body, id: i.id });
    setBusy(null);
    if (!r.ok) return setMsg({ id: i.id, text: String(r.j.error ?? "That didn't work."), bad: true });
    setMsg({ id: i.id, text: done });
    await reload();
    refreshNeeds();
  }

  return (
    <>
      <PageHead title="Needs you" lead="Everything waiting on a person, oldest first. Items clear themselves when they're sorted elsewhere." />
      <div className="con-filters">
        <Select label="Show" value={values.kind} onChange={(v) => set({ kind: v })} options={KINDS} />
        <Select
          label="Which"
          value={values.snoozed ? "snoozed" : values.mine ? "mine" : ""}
          onChange={(v) => set({ snoozed: v === "snoozed" ? "1" : null, mine: v === "mine" ? "1" : null })}
          options={[
            ["", "Waiting now"],
            ["mine", "Handed to me"],
            ["snoozed", `Snoozed${data?.snoozed ? ` (${data.snoozed})` : ""}`],
          ]}
        />
      </div>
      <Problem err={err} />
      {msg && data && !data.items.some((i) => i.id === msg.id) && (
        <p className={msg.bad ? "error" : "con-ok"} role="status">
          {msg.text}
        </p>
      )}
      {!data && !err && <Loading />}
      {data && data.items.length === 0 && <p className="con-calm big">{values.snoozed ? "Nothing's snoozed." : "Nothing needs you. Well done."}</p>}
      {data && (
        <ol className="con-needs">
          {data.items.map((i) => {
            const due = i.dueAt ? Math.ceil((Date.parse(i.dueAt) - now) / 864e5) : null;
            const buttons = (BUTTONS[i.kind] ?? []).filter((b) => !b.owner || user.role === "owner");
            return (
              <li key={i.id} id={i.id} className="con-need">
                <div className="con-need-head">
                  <span className="con-kind">{i.kindWords}</span>
                  <span className="con-age">
                    {age(i.createdAt)}
                    {due != null && <strong className={due <= 7 ? "con-warn" : undefined}>{due > 0 ? `, ${due} days left` : ", overdue"}</strong>}
                  </span>
                </div>
                <h2>{i.title}</h2>
                <p className="con-need-on">
                  {i.tournament && (i.tournament.slug ? <Link href={`/console/tournaments/${i.tournament.id}`}>{i.tournament.name}</Link> : i.tournament.name)}
                  {i.tournament && i.person && ", "}
                  {i.person && <PersonLink email={i.person} />}
                  {typeof i.detail?.error === "string" && <span className="con-need-detail">What went wrong: {i.detail.error}</span>}
                  {typeof i.detail?.about === "string" && <span className="con-need-detail">About it: {i.detail.about}</span>}
                  {i.assignedTo && <span className="con-need-detail">Handed to {i.assignedTo === user.email ? "you" : i.assignedTo}</span>}
                  {i.snoozedUntil && Date.parse(i.snoozedUntil) > now && <span className="con-need-detail">Snoozed until {day(i.snoozedUntil, false)}</span>}
                </p>
                {i.kind === "spend" && user.role === "owner" && (
                  <p className="con-need-on">
                    <Link href={i.tournament ? `/console/tournaments/${i.tournament.id}?tab=money` : "/console/money"}>Raise the limit</Link>
                  </p>
                )}
                {i.kind === "email_failing" && i.person && user.role === "owner" && (
                  <p className="con-need-on">
                    <PersonLink email={i.person}>Correct the address</PersonLink>
                  </p>
                )}
                <div className="con-need-acts">
                  {buttons.map((b) => (
                    <button key={b.action + b.label} className={`btn${b.primary ? "" : " secondary"}`} disabled={!!busy} onClick={() => run(i, { action: b.action, resolution: b.resolution }, "Done.")}>
                      {busy === `${i.id}:${b.action}` ? "Working…" : b.label}
                    </button>
                  ))}
                  <button className="btn secondary" disabled={!!busy} onClick={() => run(i, { action: "needs.snooze" }, "Snoozed until tomorrow.")}>
                    Snooze until tomorrow
                  </button>
                  {people.length > 1 && (
                    <label className="con-assign">
                      <span>Hand to</span>
                      <select value={i.assignedTo ?? ""} disabled={!!busy} onChange={(e) => run(i, { action: "needs.assign", to: e.target.value }, e.target.value ? `Handed to ${e.target.value}.` : "Taken back.")}>
                        <option value="">Nobody</option>
                        {people.map((p) => (
                          <option key={p} value={p}>
                            {p === user.email ? "Me" : p}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {msg?.id === i.id && (
                  <p className={msg.bad ? "error" : "con-ok"} role="status">
                    {msg.text}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {data && <Pager page={page} size={50} total={data.total} onPage={(p) => set({ page: p })} />}
    </>
  );
}
