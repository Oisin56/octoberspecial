"use client";

/** A clip just filmed from the on-course bar, handed to the post page without another tap. */
let pending: File | null = null;

export function setPendingClip(f: File | null) {
  pending = f;
}

export function takePendingClip(): File | null {
  const f = pending;
  pending = null;
  return f;
}
