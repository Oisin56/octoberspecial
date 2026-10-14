import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** The brand's own pages (join, invite, privacy): the front page's header and footer around a narrow column. */
export function BrandShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-root mgs" data-theme="clubhouse">
      <header className="mgs-head">
        <div className="mgs-wrap mgs-bar">
          <Link href="/" className="mgs-mark" aria-label={`${BRAND.name} home`}>
            <span>
              {BRAND.mark[0]}
              <b>{BRAND.mark[1]}</b>
              {BRAND.mark[2]}
            </span>
          </Link>
          <Link href="/account" className="mgs-head-link quiet">
            My tournaments
          </Link>
        </div>
      </header>
      <main className="mgs-wrap fr-page">{children}</main>
      <footer className="mgs-wrap mgs-foot">
        <span>{BRAND.name}</span>
        <span className="mgs-foot-links">
          <Link href="/privacy">Privacy</Link>
          <span>Made in Ireland</span>
        </span>
      </footer>
    </div>
  );
}
