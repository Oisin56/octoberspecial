import { redirect } from "next/navigation";

/** The site owner's page is the console now (old links and bookmarks land there, with what they carried). */
export default async function OwnerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
  redirect(qs.toString() ? `/console?${qs}` : "/console");
}
