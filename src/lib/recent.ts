"use client";

/** Tournaments opened on this phone, newest first: the front page offers them back to people who've lost the link. */
export interface Recent {
  slug: string;
  name: string;
  at: number;
}
const KEY = "mgb-recent";
const MAX = 6;

export function recentTournaments(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Recent[];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.slug === "string" && typeof r.name === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberTournament(slug: string, name: string) {
  try {
    const list = [{ slug, name, at: Date.now() }, ...recentTournaments().filter((r) => r.slug !== slug)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

export function forgetTournament(slug: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentTournaments().filter((r) => r.slug !== slug)));
  } catch {}
}
