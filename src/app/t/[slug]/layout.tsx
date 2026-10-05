import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeRoot } from "@/components/ThemeRoot";

export default async function TournamentLayout({ children, params }: LayoutProps<"/t/[slug]">) {
  const { slug } = await params;
  return (
    <Providers slug={slug}>
      <ThemeRoot>
        <SiteHeader />
        <main className="wrap">{children}</main>
      </ThemeRoot>
    </Providers>
  );
}
