"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * A deliberate sideways swipe (not a tap, not a scroll): far enough, mostly horizontal, quick.
 * Spread the returned handlers on the element. Touches that start on a control that drags (a slider)
 * are ignored.
 */
export function useSwipe(handlers: { onLeft?: () => void; onRight?: () => void }) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const cb = useRef(handlers);
  useLayoutEffect(() => {
    cb.current = handlers;
  });
  return {
    onPointerDown(e: React.PointerEvent) {
      if ((e.target as HTMLElement).closest("[data-noswipe], input, textarea, select")) return (start.current = null);
      start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    onPointerUp(e: React.PointerEvent) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - s.t > 900) return;
      if (dx < 0) cb.current.onLeft?.();
      else cb.current.onRight?.();
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}
