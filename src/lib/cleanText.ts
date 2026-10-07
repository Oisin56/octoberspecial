/**
 * Make AI-written text safe to show as plain prose: recovers a body that arrived
 * wrapped in JSON, and removes Markdown symbols (#, **, _, ```), so readers never
 * see "code". Paragraphs stay separated by blank lines; a subheading stays on its
 * own line. Idempotent: running it twice changes nothing.
 */
export function cleanBody(raw: string): string {
  let s = (raw ?? "").replace(/\r\n?/g, "\n").trim();

  // A whole JSON answer stored as the body ({"title": "...", "body": "..."})
  if (/^\s*(```(json)?\s*)?\{[\s\S]*"body"\s*:/.test(s)) {
    const inner = s.replace(/^```(json)?\s*|```\s*$/g, "").trim();
    let recovered: string | null = null;
    try {
      const j = JSON.parse(inner);
      if (typeof j.body === "string") recovered = j.body;
    } catch {
      // Broken JSON (e.g. cut off): take everything after "body": " and unescape it
      const m = inner.match(/"body"\s*:\s*"([\s\S]*)/);
      if (m) {
        recovered = m[1]
          .replace(/"\s*}\s*$/, "")
          .replace(/"\s*,\s*"[a-z_]+"\s*:[\s\S]*$/i, "")
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, " ")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    }
    if (recovered != null) s = recovered.trim();
  }
  // Literal escape sequences left in plain text
  if (!s.includes("\n") && s.includes("\\n")) s = s.replace(/\\n/g, "\n");

  s = s
    .replace(/^```[a-z]*[ \t]*$/gim, "") // code fences
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "$1") // # headings -> plain line
    .replace(/^[ \t]*>[ \t]?/gm, "") // block quotes
    .replace(/^[ \t]*(?:---|\*\*\*|___)[ \t]*$/gm, "") // horizontal rules
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2") // italics
    .replace(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^[ \t]*[*•][ \t]+/gm, "– ") // bullets as en-dash lines
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1") // links -> their words
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export function cleanTitle(raw: string): string {
  return cleanBody(raw).replace(/\s*\n\s*/g, " ").replace(/^["“]|["”]$/g, "").trim();
}
