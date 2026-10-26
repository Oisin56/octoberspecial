import type { Instrumentation } from "next";

/**
 * Errors for the console: anything the server logs as an error, and any request that fails outright, is written down
 * (grouped) for the Health page.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("./lib/incidents");
  const original = console.error.bind(console);
  let inside = false;
  console.error = (...args: unknown[]) => {
    original(...args);
    if (inside) return;
    inside = true;
    try {
      const place = typeof args[0] === "string" ? args[0].slice(0, 80) : "server";
      const err = args.find((a) => a instanceof Error) ?? args.slice(typeof args[0] === "string" ? 1 : 0).map(String).join(" ");
      // A spending limit reached isn't a fault
      if (!(err instanceof Error && err.name === "SpendStopped")) void recordError(place, err || place);
    } finally {
      inside = false;
    }
  };
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("./lib/incidents");
  await recordError(`${context.routeType} ${context.routePath}`, err, { tid: null });
};
