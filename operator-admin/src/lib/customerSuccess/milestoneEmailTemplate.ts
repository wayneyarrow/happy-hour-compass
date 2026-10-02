/**
 * Venue-view-milestone email template (Customer Success Phase 1B preview).
 *
 * Pure rendering — no Resend, no Slack, no Supabase, no side effects of any
 * kind. Returns { subject, previewText, html, text }. This is the SAME
 * function the real send step will call once Phase 1B sending is
 * implemented (and the same function the temporary preview route renders)
 * — there is no separate throwaway markup to maintain.
 *
 * DESIGN DIRECTION: a personal note from Wayne with a small "achievement
 * card" (the milestone number) embedded in it — not a newsletter, not a
 * marketing email. No CTA button, no footer navigation, no social icons,
 * no secondary content blocks. See milestoneEmailCopy.ts for the approved
 * wording this renders unmodified (only the {venue} token is substituted).
 *
 * Draft Two revision: the email no longer opens with a logo — it opens
 * directly with "Hi [First Name],", like a real personal email. HHC
 * branding moved to the sign-off instead: "Wayne | Founder" / "Happy Hour
 * Compass" / a small horizontal logo directly beneath. Branding now reads
 * as part of who the note is from, not as a campaign header.
 *
 * BRAND REUSE (not a separate "email brand"):
 *   - Signature logo: /hhc-logo-horizontal-header.png — the existing,
 *     tightly-cropped horizontal HHC lockup already used in production by
 *     WebsiteHeader.tsx (the public website header). Chosen over
 *     /hhc-logo-horizontal.png, which is a square canvas with excessive
 *     white padding around the same artwork, and over the stacked square
 *     /logo.png every other HHC email uses — a horizontal mark reads more
 *     like a signature lockup than a masthead. Rendered at 110px wide
 *     (sized down from an initial 140px so it reads as roughly the same
 *     visual width as the "Happy Hour Compass" text line above it, rather
 *     than standing out as its own element), height auto to preserve its
 *     native 747:247 aspect ratio.
 *   - Colors: the same tokens already established for HHC emails —
 *     heading/body text #0f172a / #475569 / #64748b / #94a3b8, borders
 *     #e2e8f0, background #f8fafc, and the amber accent #d97706 already
 *     used for every existing email's CTA/accent color (emailCta(),
 *     emailWhatHappensNext()) — reused here for the milestone number and
 *     sparkle accents instead of introducing a new hex palette.
 *   - Font stack: the same system-font stack every HHC email already uses.
 *
 * EMAIL-CLIENT COMPATIBILITY:
 *   - Table-based layout throughout (no flexbox/grid) — same technique as
 *     emailLayout() in email.ts, for the same reason: broad Outlook/legacy
 *     client support.
 *   - All styling is inline (no <style> block, no CSS classes) — matches
 *     this codebase's existing email pattern and avoids client CSS
 *     stripping.
 *   - System font stack only — no @font-face / web fonts.
 *   - Single-column, fixed max-width (480px) — no responsive breakpoints
 *     that rely on media queries most email clients strip anyway; the
 *     fixed width plus generous padding reads fine on mobile mail clients
 *     without needing them.
 *   - Hidden preheader <div> carries the inbox preview-text snippet — a
 *     standard, universally-supported technique (not exotic CSS).
 */

import { getSiteUrl } from "@/lib/siteUrl";
import { getMilestoneEmailCopy, MILESTONE_EMAIL_CLOSING, type MilestoneCopy } from "./milestoneEmailCopy";

export type VenueViewMilestoneEmailInput = {
  milestone: number;
  /** Recipient's first name, e.g. "Kelly". Rendered as "Hi Kelly,". */
  firstName: string;
  venueName: string;
  /** Defaults to "Wayne" — the sign-off name. */
  senderFirstName?: string;
  /** Defaults to "Founder" — rendered as "{senderFirstName} | {senderTitle}". */
  senderTitle?: string;
  /**
   * "incomplete_setup" (operator hasn't finished account setup) adds a short
   * Finish-your-setup block whose button links to the durable, token-free
   * FINISH_SETUP_PATH page. Defaults to "standard" (unchanged email).
   */
  variant?: MilestoneEmailVariantKind;
};

export type MilestoneEmailVariantKind = "standard" | "incomplete_setup";

/** Durable, non-secret finish-setup page. Opening it never creates or uses a setup token. */
export const FINISH_SETUP_PATH = "/operator/finish-setup";

/** Approved-for-review copy for the incomplete-setup block. `{venue}` is filled at render time. */
export const INCOMPLETE_SETUP_COPY = {
  heading: "Make the most of those views",
  body: "People are finding {venue} on Happy Hour Compass. Finish setting up your account so you can keep your happy hour details and events up to date.",
  button: "Finish your setup",
  footnote: "It only takes a couple of minutes. Already set up? You can ignore this.",
} as const;

export function finishSetupUrl(): string {
  return `${getSiteUrl()}${FINISH_SETUP_PATH}`;
}

export type RenderedVenueViewMilestoneEmail = {
  subject: string;
  previewText: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fillVenue(template: string, venueName: string): string {
  return template.replaceAll("{venue}", venueName);
}

/**
 * Renders the venue-view-milestone email for one of the 7 approved
 * milestones. Throws if `milestone` isn't one of them — callers (the
 * detector's pending events, the preview route) should only ever pass a
 * value from MILESTONE_EMAIL_VALUES / VENUE_VIEW_MILESTONES.
 */
export function renderVenueViewMilestoneEmail(
  input: VenueViewMilestoneEmailInput
): RenderedVenueViewMilestoneEmail {
  const copy = getMilestoneEmailCopy(input.milestone);
  if (!copy) {
    throw new Error(`renderVenueViewMilestoneEmail: ${input.milestone} is not an approved milestone`);
  }

  const senderFirstName = input.senderFirstName ?? "Wayne";
  const senderTitle = input.senderTitle ?? "Founder";
  const subject = fillVenue(copy.subject, input.venueName);

  return {
    subject,
    previewText: copy.previewText,
    html: buildHtml({ copy, input, senderFirstName, senderTitle }),
    text: buildText({ copy, input, senderFirstName, senderTitle }),
  };
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function buildHtml({
  copy,
  input,
  senderFirstName,
  senderTitle,
}: {
  copy: MilestoneCopy;
  input: VenueViewMilestoneEmailInput;
  senderFirstName: string;
  senderTitle: string;
}): string {
  const signatureLogoUrl = `${getSiteUrl()}/hhc-logo-horizontal-header.png`;
  const firstName = escapeHtml(input.firstName);
  const venueName = escapeHtml(input.venueName);
  const headline = escapeHtml(copy.headline);
  const previewText = escapeHtml(copy.previewText);
  const bodyParagraph1 = escapeHtml(fillVenue(copy.body[0], input.venueName));
  const bodyParagraph2 = escapeHtml(copy.body[1]);
  const closing = escapeHtml(MILESTONE_EMAIL_CLOSING);
  const setupBlock = input.variant === "incomplete_setup" ? buildSetupBlockHtml(input.venueName) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${venueName} — ${copy.displayValue} views</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <!-- Preheader: sets the inbox preview snippet, hidden from the rendered body -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">
    ${previewText}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr>
      <td align="center" style="padding:32px 20px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

          <!-- Personal greeting — the email opens here, no logo/header above it -->
          <tr>
            <td style="padding:0 0 4px;">
              <p style="margin:0;font-size:16px;color:#0f172a;line-height:1.6;">Hi ${firstName},</p>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:14px 0 24px;">
              <h1 style="margin:0;font-size:22px;line-height:1.35;font-weight:700;color:#0f172a;">${headline}</h1>
            </td>
          </tr>

          <!-- Achievement card: the one bordered element in the email -->
          <tr>
            <td style="padding:0 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:16px;">
                <tr>
                  <td align="center" style="padding:32px 24px 28px;">
                    <p style="margin:0 0 10px;font-size:15px;letter-spacing:0.14em;color:#d97706;">&#10022;&nbsp;&nbsp;&#10022;&nbsp;&nbsp;&#10022;</p>
                    <p style="margin:0;font-size:60px;line-height:1;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;">${copy.displayValue}</p>
                    <p style="margin:10px 0 0;font-size:12px;font-weight:700;letter-spacing:0.14em;color:#b45309;text-transform:uppercase;">${copy.label}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body copy -->
          <tr>
            <td style="padding:0 0 6px;">
              <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.65;">${bodyParagraph1}</p>
              <p style="margin:0;font-size:15px;color:#475569;line-height:1.65;">${bodyParagraph2}</p>
            </td>
          </tr>${setupBlock}

          <!-- Sign-off — HHC branding lives here now, not at the top -->
          <tr>
            <td style="padding:28px 0 0;">
              <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">${closing}</p>
              <p style="margin:0 0 2px;font-size:15px;color:#0f172a;">
                <span style="font-weight:700;">${escapeHtml(senderFirstName)}</span>
                <span style="font-weight:400;color:#64748b;"> | ${escapeHtml(senderTitle)}</span>
              </p>
              <p style="margin:0 0 14px;font-size:13px;color:#94a3b8;">Happy Hour Compass</p>
              <img src="${signatureLogoUrl}" alt="Happy Hour Compass" width="110" style="display:block;width:110px;height:auto;border:0;">
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Incomplete-setup block ───────────────────────────────────────────────────

function buildSetupBlockHtml(venueName: string): string {
  const body = escapeHtml(fillVenue(INCOMPLETE_SETUP_COPY.body, venueName));
  return `
          <!-- Incomplete setup: finish-setup invitation (durable, non-secret link) -->
          <tr>
            <td style="padding:24px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:22px 0 0;">
                    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtml(INCOMPLETE_SETUP_COPY.heading)}</p>
                    <p style="margin:0 0 18px;font-size:15px;color:#475569;line-height:1.65;">${body}</p>
                    <a href="${finishSetupUrl()}" style="display:inline-block;background:#d97706;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;">${escapeHtml(INCOMPLETE_SETUP_COPY.button)} &rarr;</a>
                    <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;line-height:1.5;">${escapeHtml(INCOMPLETE_SETUP_COPY.footnote)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function buildSetupBlockText(venueName: string): string {
  return `
${INCOMPLETE_SETUP_COPY.heading}

${fillVenue(INCOMPLETE_SETUP_COPY.body, venueName)}

${INCOMPLETE_SETUP_COPY.button}: ${finishSetupUrl()}
${INCOMPLETE_SETUP_COPY.footnote}
`;
}

// ── Plain text ───────────────────────────────────────────────────────────────

function buildText({
  copy,
  input,
  senderFirstName,
  senderTitle,
}: {
  copy: MilestoneCopy;
  input: VenueViewMilestoneEmailInput;
  senderFirstName: string;
  senderTitle: string;
}): string {
  const bodyParagraph1 = fillVenue(copy.body[0], input.venueName);
  const bodyParagraph2 = copy.body[1];

  return `Hi ${input.firstName},

${copy.headline}

${copy.displayValue} ${copy.label}

${bodyParagraph1}

${bodyParagraph2}
${input.variant === "incomplete_setup" ? buildSetupBlockText(input.venueName) : ""}
${MILESTONE_EMAIL_CLOSING}

${senderFirstName} | ${senderTitle}
Happy Hour Compass`;
}
