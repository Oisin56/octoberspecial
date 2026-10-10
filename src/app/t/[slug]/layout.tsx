import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeRoot } from "@/components/ThemeRoot";
import { ClipQueue } from "@/components/ClipQueue";
import { OnCourseBar } from "@/components/OnCourseBar";
import type { Metadata, Viewport } from "next";
import { tournamentBySlug } from "@/lib/server-data";
import { paletteFor } from "@/lib/themes";

export async function generateMetadata({ params }: LayoutProps<"/t/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const t = await tournamentBySlug(slug).catch(() => null);
  return {
    // Add to Home Screen: a full-screen app that opens straight into the live round
    manifest: `/t/${slug}/app.webmanifest`,
    appleWebApp: { capable: true, title: t?.name ?? BRAND.short, statusBarStyle: "default" },
    icons: { apple: "/api/app-icon?s=180" },
  };
}

export async function generateViewport({ params }: LayoutProps<"/t/[slug]">): Promise<Viewport> {
  const { slug } = await params;
  const t = await tournamentBySlug(slug).catch(() => null);
  return { themeColor: t ? paletteFor(t.theme, t.custom_colors).board : "#1f3d2b", viewportFit: "cover" };
}

export default async function TournamentLayout({ children, params }: LayoutProps<"/t/[slug]">) {
  const { slug } = await params;
  return (
    <Providers slug={slug}>
      <ThemeRoot>
        <SiteHeader />
        <ClipQueue />
        <main className="wrap">{children}</main>
        <OnCourseBar />
        <footer className="made-with">
          <Link href="/">Made with {BRAND.name}</Link>
        </footer>
      </ThemeRoot>
    </Providers>
  );
}
