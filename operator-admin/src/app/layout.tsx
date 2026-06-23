import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { getSiteUrl, shouldNoIndex } from "@/lib/siteUrl";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    template: "%s — Happy Hour Compass",
    default: "Happy Hour Compass",
  },
  description: "Happy Hour Compass — find the best happy hours near you.",
  icons: { icon: "/hhc-icon.png" },
  ...(shouldNoIndex() && { robots: { index: false, follow: false } }),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
