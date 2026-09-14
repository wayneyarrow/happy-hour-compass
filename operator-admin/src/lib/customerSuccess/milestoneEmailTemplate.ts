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
 * BRAND REUSE (not a separate "email brand"):
 *   - Logo: /logo.png — the exact asset every other HHC transactional email
 *     already uses (see emailLayout() in email.ts, and every operator-facing
 *     auth page: login, create-password, activate-account).
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
};

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
  const subject = fillVenue(copy.subject, input.venueName);

  return {
    subject,
    previewText: copy.previewText,
    html: buildHtml({ copy, input, senderFirstName }),
    text: buildText({ copy, input, senderFirstName }),
  };
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function buildHtml({
  copy,
  input,
  senderFirstName,
}: {
  copy: MilestoneCopy;
  input: VenueViewMilestoneEmailInput;
  senderFirstName: string;
}): string {
  const logoUrl = `${getSiteUrl()}/logo.png`;
  const firstName = escapeHtml(input.firstName);
  const venueName = escapeHtml(input.venueName);
  const headline = escapeHtml(copy.headline);
  const previewText = escapeHtml(copy.previewText);
  const bodyParagraph1 = escapeHtml(fillVenue(copy.body[0], input.venueName));
  const bodyParagraph2 = escapeHtml(copy.body[1]);
  const closing = escapeHtml(MILESTONE_EMAIL_CLOSING);

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
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

          <!-- Logo: small, left-aligned — present but not the focus -->
          <tr>
            <td style="padding:0 0 28px;text-align:left;">
              <img src="${logoUrl}" alt="Happy Hour Compass" width="72" style="display:block;width:72px;height:auto;border:0;">
            </td>
          </tr>

          <!-- Personal greeting -->
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
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:28px 0 0;">
              <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.65;">${closing}</p>
              <p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#0f172a;">${escapeHtml(senderFirstName)}</p>
              <p style="margin:0;font-size:13px;color:#94a3b8;">Happy Hour Compass</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Plain text ───────────────────────────────────────────────────────────────

function buildText({
  copy,
  input,
  senderFirstName,
}: {
  copy: MilestoneCopy;
  input: VenueViewMilestoneEmailInput;
  senderFirstName: string;
}): string {
  const bodyParagraph1 = fillVenue(copy.body[0], input.venueName);
  const bodyParagraph2 = copy.body[1];

  return `Hi ${input.firstName},

${copy.headline}

${copy.displayValue} ${copy.label}

${bodyParagraph1}

${bodyParagraph2}

${MILESTONE_EMAIL_CLOSING}

${senderFirstName}
Happy Hour Compass`;
}
