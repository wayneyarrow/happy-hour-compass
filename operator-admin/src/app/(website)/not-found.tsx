import type { Metadata } from "next";
import { NotFoundContent } from "./NotFoundContent";

/**
 * Shared public website 404 experience (Public Website 404 task).
 *
 * Placed at the (website) route-group root so Next.js uses it as the
 * not-found boundary for every route nested under this group — every
 * existing `notFound()` call already made by public pages (venue, guide,
 * Collection Landing Page, etc.) resolves here automatically, and every
 * future public route gets it for free with zero per-route wiring. It
 * renders nested inside (website)/layout.tsx, so the normal WebsiteHeader
 * and WebsiteFooter are already present — this file only supplies the
 * content between them.
 *
 * Deliberately does not live at the app root: the Consumer App, Operator
 * Admin, and Founder Control Panel are separate presentation layers (see
 * CLAUDE.md) and must not inherit the public website's 404 styling.
 */

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function WebsiteNotFound() {
  return <NotFoundContent />;
}
