/** A piece as numbered sentences, for the fact check (pure). */

export interface Sentence {
  n: number;
  /** Paragraph it belongs to */
  p: number;
  text: string;
}

/** A piece as numbered sentences (a subheading is one); joined back with `joinSentences` */
export function splitSentences(body: string): Sentence[] {
  const out: Sentence[] = [];
  body
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((para, p) => {
      for (const line of para.split(/\n/)) {
        const parts = line.match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)/g) ?? [line];
        // Keep short scraps (initials, "No. 1") with the sentence before
        const merged: string[] = [];
        for (const raw of parts.map((x) => x.trim()).filter(Boolean)) {
          if (merged.length && (raw.length < 4 || /^[a-z]/.test(raw) || (/\d\.$/.test(merged[merged.length - 1]) && /^\d/.test(raw)) || /\b(St|Mr|Mrs|Dr|No)\.$/.test(merged[merged.length - 1]))) merged[merged.length - 1] += /\d\.$/.test(merged[merged.length - 1]) && /^\d/.test(raw) ? raw : ` ${raw}`;
          else merged.push(raw);
        }
        for (const t of merged) out.push({ n: out.length + 1, p, text: t });
      }
    });
  return out;
}

export function joinSentences(list: Sentence[]): string {
  const paras = new Map<number, string[]>();
  for (const s of list) if (s.text.trim()) paras.set(s.p, [...(paras.get(s.p) ?? []), s.text.trim()]);
  return [...paras.keys()]
    .sort((a, b) => a - b)
    .map((p) => paras.get(p)!.join(" "))
    .join("\n\n");
}

