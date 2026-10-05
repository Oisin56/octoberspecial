"use client";

import { useEffect } from "react";
import { useT } from "./Providers";

/** Applies the tournament's theme (and custom colours) to everything inside. */
export function ThemeRoot({ children }: { children: React.ReactNode }) {
  const { state } = useT();
  const t = state?.tournament;
  const theme = t?.theme ?? "clubhouse";
  const custom = theme === "custom" ? t?.custom_colors : null;
  const style = custom
    ? ({
        ...(custom.primary ? { "--board": custom.primary, "--board-deep": `color-mix(in srgb, ${custom.primary} 70%, black)`, "--board-line": `color-mix(in srgb, ${custom.primary} 80%, white)` } : {}),
        ...(custom.accent ? { "--red": custom.accent } : {}),
        ...(custom.background ? { "--mist": custom.background } : {}),
      } as React.CSSProperties)
    : undefined;

  // Team colours available to the whole page as --team-<id>
  const teamVars = Object.fromEntries((t?.teams ?? []).map((tm, i) => [`--team-${i}`, tm.color || (i === 0 ? "#c8102e" : "#1d4f91")]));

  useEffect(() => {
    if (t?.name) document.title = t.name;
    const meta = document.querySelector('meta[name="theme-color"]');
    const c = getComputedStyle(document.querySelector(".theme-root") as Element).getPropertyValue("--board").trim();
    if (meta && c) meta.setAttribute("content", c);
  }, [t?.name, theme]);

  return (
    <div className="theme-root" data-theme={theme} style={{ ...teamVars, ...style }}>
      {children}
    </div>
  );
}
