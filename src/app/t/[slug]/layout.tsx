import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeRoot } from "@/components/ThemeRoot";
import { ClipQueue } from "@/components/ClipQueue";
import { SignPrompt } from "@/components/SignPrompt";
import { LiveStrip } from "@/components/LiveStrip";
import { TabBar } from "@/components/TabBar";
import { GpsTab } from "@/components/GpsTab";
import type { Metadata, Viewport } from "next";
import { tournamentBySlug } from "@/lib/server-data";
import { paletteFor } from "@/lib/themes";
import { isDemo } from "@/lib/site";

export async function generateMetadata({ params }: LayoutProps<"/t/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const t = await tournamentBySlug(slug).catch(() => null);
  return {
    // Add to Home Screen: a full-screen app that opens straight into the live round
    manifest: `/t/${slug}/app.webmanifest`,
    appleWebApp: { capable: true, title: t?.name ?? BRAND.short, statusBarStyle: "default" },
    icons: { apple: "/api/app-icon?s=180" },
    // Seen only by people given the link: kept out of search engines
    robots: { index: false, follow: false },
  };
}

export async function generateViewport({ params }: LayoutProps<"/t/[slug]">): Promise<Viewport> {
  const { slug } = await params;
  const t = await tournamentBySlug(slug).catch(() => null);
  return { themeColor: t ? paletteFor(t.theme, t.custom_colors).board : "#1f3d2b", viewportFit: "cover" };
}

export default async function TournamentLayout({ children, params }: LayoutProps<"/t/[slug]">) {
  const { slug } = await params;
  const demo = await isDemo(slug).catch(() => false);
  return (
    <Providers slug={slug} demo={demo}>
      <ThemeRoot>
        {demo && (
          <div className="demo-banner" role="note">
            <span>This is an example tournament.</span>
            <Link href="/invite">Start your own</Link>
          </div>
        )}
        <SiteHeader />
        <LiveStrip />
        <ClipQueue />
        <SignPrompt />
        <main className="wrap">{children}</main>
        <TabBar />
        <GpsTab />
        <footer className="made-with">
          <Link href="/">Made with {BRAND.name}</Link>
        </footer>
      </ThemeRoot>
    </Providers>
  );
}
