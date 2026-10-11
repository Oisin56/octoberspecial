"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/** A panel that slides up from the bottom (big Close button, Escape closes, the page behind doesn't scroll). */
export function Sheet({ label, onClose, children, dark, tall }: { label: string; onClose: () => void; children: React.ReactNode; dark?: boolean; tall?: boolean }) {
  useEffect(() => {
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => {
      html.style.overflow = was;
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const host = document.querySelector(".theme-root") ?? document.body;
  return createPortal(
    <div className={`sf-sheet-wrap${dark ? " dark" : ""}`}>
      <button className="sf-backdrop" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <div className={`sf-sheet${tall ? " tall" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <div className="sf-sheet-head">
          <h2>{label}</h2>
          <button className="sf-close" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    host,
  );
}
