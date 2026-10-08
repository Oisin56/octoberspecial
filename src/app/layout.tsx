import type { Metadata, Viewport } from "next";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MyGolfSpecial", template: "%s | MyGolfSpecial" },
  description: "Live scores, previews, match reports and a highlights film for your golf trip.",
  applicationName: "MyGolfSpecial",
};

export const viewport: Viewport = {
  themeColor: "#1f3d2b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IE">
      <body>{children}</body>
    </html>
  );
}
