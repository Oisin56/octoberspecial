"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loading, PageHead, Problem } from "@/components/console/kit";
import { EmailTabs, WordsEditor, useEmailView, type EmailOne } from "@/components/console/email";

function Edit() {
  const key = useSearchParams().get("key") ?? "";
  const series = key.startsWith("series:") ? key.split(":")[1] : null;
  const { data, err, reload } = useEmailView<EmailOne>("email", { key });
  return (
    <>
      <p className="con-crumb">{series ? <Link href={`/console/email/series/${series}`}>{data?.name ?? "The series"}</Link> : <Link href="/console/email">Every email</Link>}</p>
      <PageHead title={series ? "A step in the series" : (data?.name ?? "Email")} lead={data?.about} />
      <EmailTabs />
      <Problem err={err} />
      {!data ? !err && <Loading /> : <WordsEditor key={`${data.key}:${data.words.version}`} data={data} onSaved={reload} />}
    </>
  );
}

export default function EditEmail() {
  return (
    <Suspense>
      <Edit />
    </Suspense>
  );
}
