import "server-only";
import { adminClient } from "./admin";

/**
 * The activity record: every action in the console, who took it and on what. Nobody can change it (the database
 * refuses), and it's kept for two years.
 */
export interface Actor {
  email: string;
  role: "owner" | "support" | "system" | "person";
}

export const SYSTEM: Actor = { email: "system", role: "system" };

export async function logActivity(
  actor: Actor,
  action: string,
  on: { tournamentId?: string | null; tournamentName?: string | null; person?: string | null; detail?: Record<string, unknown> } = {},
) {
  const { error } = await adminClient()
    .from("activity")
    .insert({
      actor: actor.email,
      actor_role: actor.role,
      action,
      tournament_id: on.tournamentId ?? null,
      tournament_name: on.tournamentName ?? null,
      person: on.person ? on.person.toLowerCase() : null,
      detail: on.detail ?? null,
    });
  if (error) console.warn("[activity] not recorded", error.message);
}

export { ACTION_WORDS } from "./activity-words";
