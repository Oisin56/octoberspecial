import "server-only";
import { adminClient } from "./admin";
import { DEFAULT_LIMITS, type BrandPack, type FilmLimits, type MusicTrack } from "./film";

/**
 * Site-wide settings kept by the site owner: the brand pack, the music tracks, the film spending limits.
 * Before the database has the table (schema.sql not run yet), everything reads as unset.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await adminClient().from("site_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return (data.value as T) ?? fallback;
}

export async function setSetting(key: "brand" | "music" | "films" | "demo" | "sample" | "budgets" | "console" | "bills" | "cron", value: unknown) {
  const { error } = await adminClient().from("site_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(/site_settings/.test(error.message) ? "This needs the latest database update (run supabase/schema.sql)" : error.message);
}

export const brandPack = () => getSetting<BrandPack>("brand", {});

/** The front page's sample round: its commentary, recorded once by the site owner in the film's voices */
export interface SampleFilmSetting {
  lines: { path: string; sec: number; text: string }[];
  at: string;
  /** The recordings before these: removed next time */
  previous?: string[];
}
export const sampleFilm = async () => {
  const v = await getSetting<SampleFilmSetting | null>("sample", null);
  return v && Array.isArray(v.lines) ? v : null;
};
export const musicTracks = async () => {
  const t = await getSetting<MusicTrack[]>("music", []);
  return Array.isArray(t) ? t : [];
};
export async function filmLimits(): Promise<FilmLimits> {
  const v = await getSetting<Partial<FilmLimits>>("films", {});
  return {
    monthlyCents: Number.isFinite(Number(v.monthlyCents)) ? Number(v.monthlyCents) : DEFAULT_LIMITS.monthlyCents,
    perTournament: Number.isFinite(Number(v.perTournament)) ? Number(v.perTournament) : DEFAULT_LIMITS.perTournament,
  };
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

/** What films have cost across the whole site this calendar month, and how many were made. */
export async function filmSpend(): Promise<{ cents: number; films: number }> {
  const { data, error } = await adminClient().from("reels").select("cost_cents,renders").gte("done_at", monthStart());
  if (error) return { cents: 0, films: 0 };
  return {
    cents: Math.round((data ?? []).reduce((t, r) => t + Number(r.cost_cents ?? 0), 0) * 100) / 100,
    films: (data ?? []).reduce((t, r) => t + Number(r.renders ?? 0), 0),
  };
}

/** Films made for one tournament (finished ones, and any being made now). */
export async function tournamentFilms(tournamentId: string): Promise<{ made: number; inProgress: boolean }> {
  const { data, error } = await adminClient().from("reels").select("renders,status,stage").eq("tournament_id", tournamentId);
  if (error) return { made: 0, inProgress: false };
  return {
    made: (data ?? []).reduce((t, r) => t + Number(r.renders ?? 0), 0),
    inProgress: (data ?? []).some((r) => r.stage && r.stage !== "done" && r.status !== "failed" && r.status !== "draft"),
  };
}

/** The example tournament shown from the front page (read-only for everyone but the site owner), if one is set. */
export async function demoSlug(): Promise<string | null> {
  const v = await getSetting<{ slug?: string | null }>("demo", {});
  return typeof v?.slug === "string" && v.slug ? v.slug : null;
}
export const isDemo = async (slug: string | null | undefined) => !!slug && (await demoSlug()) === slug;
