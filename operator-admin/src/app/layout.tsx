import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Happy Hour Compass – Operator Admin",
  description: "Operator admin portal for Happy Hour Compass",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
