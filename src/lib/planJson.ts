/** Pull the plan's JSON out of a reply: tolerates code fences, a sentence around it, smart quotes and trailing commas. */
export function readPlanJson(text: string): Record<string, unknown> | null {
  const body = text.replace(/```(?:json)?/gi, "");
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  const raw = body.slice(a, b + 1);
  for (const candidate of [raw, raw.replace(/,\s*([}\]])/g, "$1").replace(/[\u201c\u201d](?=\s*[:,}\]])|(?<=[{,:\[]\s*)[\u201c\u201d]/g, '"')]) {
    try {
      const j = JSON.parse(candidate);
      if (j && typeof j === "object") return j as Record<string, unknown>;
    } catch {
      /* try the next */
    }
  }
  return null;
}

