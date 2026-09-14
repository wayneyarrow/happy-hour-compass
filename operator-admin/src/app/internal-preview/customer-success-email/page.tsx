import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MILESTONE_EMAIL_VALUES } from "@/lib/customerSuccess/milestoneEmailCopy";
import { renderVenueViewMilestoneEmail } from "@/lib/customerSuccess/milestoneEmailTemplate";
import { MilestoneEmailPreviewClient, type MilestoneEmailVariant } from "./MilestoneEmailPreviewClient";

/**
 * Temporary internal preview of the venue-view-milestone email template
 * (Customer Success Phase 1B design/preview step). Renders the SAME
 * renderVenueViewMilestoneEmail() function Phase 1B's real send step will
 * eventually call — this page has no email markup of its own.
 *
 * Not linked from any navigation. noindex regardless of environment (see
 * metadata below). Additionally refuses to render at all on
 * VERCEL_ENV=production (see the guard below) — this repo's existing
 * internal-preview precedent (src/app/marketing-preview/analytics/page.tsx)
 * doesn't restrict by environment, but this page renders unreleased,
 * unapproved copy/design rather than fake sample numbers, so the extra
 * guard is cheap and worth adding. `website` branch deploys only ever
 * reach Vercel's Preview environment (VERCEL_ENV=preview) per CLAUDE.md, so
 * this guard only matters once/if this code is later merged to `main`.
 *
 * No database reads/writes, no Resend calls, no Slack calls, no
 * /api/track/* calls — purely a static rendering of fixed preview data.
 * Safe to delete this whole directory once Wayne/ChatGPT have reviewed the
 * design and Phase 1B moves on to real sending.
 */

export const metadata: Metadata = {
  title: "Customer Success Email Preview",
  robots: { index: false, follow: false },
};

const PREVIEW_FIRST_NAME = "Kelly";
const PREVIEW_VENUE_NAME = "Buffalo Rouge Brewing Co.";
const PREVIEW_SENDER_FIRST_NAME = "Wayne";

export default function CustomerSuccessEmailPreviewPage() {
  if (process.env.VERCEL_ENV === "production") {
    notFound();
  }

  const variants: MilestoneEmailVariant[] = MILESTONE_EMAIL_VALUES.map((milestone) => ({
    milestone,
    ...renderVenueViewMilestoneEmail({
      milestone,
      firstName: PREVIEW_FIRST_NAME,
      venueName: PREVIEW_VENUE_NAME,
      senderFirstName: PREVIEW_SENDER_FIRST_NAME,
    }),
  }));

  return (
    <MilestoneEmailPreviewClient
      variants={variants}
      firstName={PREVIEW_FIRST_NAME}
      venueName={PREVIEW_VENUE_NAME}
    />
  );
}
