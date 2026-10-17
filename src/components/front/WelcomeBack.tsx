import Link from "next/link";

/** The header's one link. Players get back into a tournament from their link (or Join my tournament, in the footer). */
export function HeaderLink() {
  return (
    <Link href="/account" className="bx-bar-link">
      Sign in
    </Link>
  );
}
