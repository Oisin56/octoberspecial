import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeRoot } from "@/components/ThemeRoot";
import { ClipQueue } from "@/components/ClipQueue";

export default async function TournamentLayout({ children, params }: LayoutProps<"/t/[slug]">) {
  const { slug } = await params;
  return (
    <Providers slug={slug}>
      <ThemeRoot>
        <SiteHeader />
        <ClipQueue />
        <main className="wrap">{children}</main>
        <footer className="made-with">
          <Link href="/">Made with {BRAND.name}</Link>
        </footer>
      </ThemeRoot>
    </Providers>
  );
}
