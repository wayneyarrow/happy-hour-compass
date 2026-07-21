/**
 * Email utility — server-side only.
 *
 * Uses Resend (https://resend.com) as the sending provider.
 *
 * Required env vars:
 *   RESEND_API_KEY   — from your Resend dashboard (resend.com/api-keys)
 *
 * Link base URL: resolved via getSiteUrl() (src/lib/siteUrl.ts) — the same
 * environment-aware canonical helper already used for SEO/metadata. This
 * used to be a separate, locally-duplicated getAppUrl() reading APP_URL
 * first; APP_URL was found (via hosted testing) to be configured with a
 * single fixed value across all Vercel environments, which sent Preview
 * (staging) email links to the unrelated legacy production deployment
 * instead of staging.happyhourcompass.com. getSiteUrl() resolves per
 * environment instead of to one fixed value.
 *
 * Sender: hello@happyhourcompass.com (verified domain).
 *
 * Resend free tier: 3,000 emails/month, 100/day.
 */

import { Resend } from "resend";
import { sendSlackAlert, sendSlackAcquisitionNotification } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";

// ── Config ────────────────────────────────────────────────────────────────────

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[EMAIL] RESEND_API_KEY is not set — Resend client cannot be created.");
    throw new Error("RESEND_API_KEY env var is not set.");
  }
  console.log("[EMAIL] RESEND_API_KEY present, key prefix:", key.slice(0, 8) + "…");
  return new Resend(key);
}

const DEFAULT_FROM = "Happy Hour Compass <hello@happyhourcompass.com>";

/**
 * Single source of truth for the internal recipient of every founder/ops
 * lifecycle notification (claims, submissions, activations). Every internal
 * notification email must read through this function rather than inlining
 * an address separately.
 *
 * Intentionally hardcoded — NOT read from process.env.FOUNDER_NOTIFICATION_EMAIL.
 * A hosted production test confirmed this env var was set to a personal
 * address (left over from early testing) in Vercel, silently overriding the
 * correct default and routing real claim/submission notifications to a
 * personal inbox instead of hello@happyhourcompass.com. There is no
 * dashboard access from this codebase to correct that env var directly, and
 * an overridable value defeats the purpose of a single, guaranteed-correct
 * internal recipient — so this now always returns the monitored HHC inbox,
 * matching the sender/support address already hardcoded everywhere else in
 * this file (DEFAULT_FROM, emailSpamCallout, emailLayout's footer).
 *
 * If the FOUNDER_NOTIFICATION_EMAIL env var still exists in any Vercel
 * environment, it is now dead configuration and can be safely removed.
 */
function getFounderNotificationEmail(): string {
  return "hello@happyhourcompass.com";
}

// ── Centralized transactional email sender ────────────────────────────────────

export type EmailCriticality = "critical" | "important" | "standard";

/**
 * Standardized send path for all transactional emails.
 *
 * Logs a structured outcome on every attempt:
 *   [EMAIL] SUCCESS type=... to=... id=...
 *   [EMAIL] FAILED  type=... to=... error=...
 *
 * Escalates to Slack on failure based on criticality:
 *   critical  → #ops-critical  (activation, password reset, claim approval)
 *   important → #ops-alerts    (founder notifications, more-info requests)
 *   standard  → console only   (informational / non-blocking)
 *
 * Slack failures are silently swallowed — sendSlackAlert never throws.
 */
export async function sendTransactionalEmail({
  type,
  to,
  subject,
  html,
  text,
  criticality,
}: {
  type: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  criticality: EmailCriticality;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({ from: DEFAULT_FROM, to, subject, html, text });

    if (error) {
      console.error(`[EMAIL] FAILED type=${type} to=${to} error=${error.message}`);
      await escalateEmailFailure({ type, to, error: error.message, criticality });
      return { ok: false, error: error.message };
    }

    console.log(`[EMAIL] SUCCESS type=${type} to=${to} id=${data?.id}`);
    return { ok: true, id: data?.id ?? undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EMAIL] FAILED type=${type} to=${to} error=${msg}`);
    await escalateEmailFailure({ type, to, error: msg, criticality });
    return { ok: false, error: msg };
  }
}

async function escalateEmailFailure({
  type,
  to,
  error,
  criticality,
}: {
  type: string;
  to: string;
  error: string;
  criticality: EmailCriticality;
}): Promise<void> {
  if (criticality === "standard") return;
  await sendSlackAlert({
    channel:  criticality === "critical" ? "ops-critical" : "ops-alerts",
    severity: criticality === "critical" ? "critical"     : "warning",
    title:    `Email Delivery Failed — ${type}`,
    message:  `A ${criticality} transactional email failed to send.`,
    metadata: {
      Type:        type,
      To:          to,
      Error:       error,
      Environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    },
  });
}

// ── Shared email layout helpers ───────────────────────────────────────────────
//
// All HHC transactional emails share one layout produced by emailLayout().
// Supporting helpers — emailCta(), emailSpamCallout(), emailWhatHappensNext() —
// are composed into the content string passed to emailLayout().
//
// Logo URL is derived from APP_URL → VERCEL_URL → localhost. The logo renders
// in production/preview; it will not render in local email clients (expected).

/**
 * Full email shell: HHC logo header → content cell → branded footer.
 * Every email function calls this and passes its inner HTML + a footer note.
 */
function emailLayout(content: string, footerNote: string): string {
  const logoUrl = `${getSiteUrl()}/logo.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:28px 40px 24px;text-align:center;border-bottom:1px solid #e2e8f0;">
            <img src="${logoUrl}" alt="Happy Hour Compass" width="110" style="display:block;margin:0 auto;width:110px;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="text-align:center;">
                <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0f172a;">Happy Hour Compass</p>
                <p style="margin:0 0 10px;font-size:12px;color:#64748b;line-height:1.5;">Helping guests discover happy hours, specials, and events.</p>
                <p style="margin:0 0 14px;font-size:12px;">
                  <a href="https://happyhourcompass.com" style="color:#d97706;text-decoration:none;">happyhourcompass.com</a>
                  &nbsp;&middot;&nbsp;
                  <a href="mailto:hello@happyhourcompass.com" style="color:#94a3b8;text-decoration:none;">hello@happyhourcompass.com</a>
                </p>
                <p style="margin:0;font-size:11px;color:#cbd5e1;">${footerNote}</p>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Amber CTA button. Use for all primary email actions. */
function emailCta(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
    <tr><td style="background:#d97706;border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
    </td></tr>
  </table>`;
}

/**
 * Prominent spam/junk callout. Add to emails where the recipient is waiting
 * for a future HHC response. Beta feedback confirmed some HHC emails land in spam.
 * Do NOT add to password resets, invitations, or activation emails.
 *
 * Do NOT add to an email that pairs 1:1 with an on-screen success modal
 * (claim/submission confirmation emails) — the modal already carries this
 * reminder, and repeating it in an email the recipient has just opened is
 * redundant. It still belongs in later, out-of-band correspondence with no
 * preceding modal (e.g. sendClaimMoreInfoEmail, sendRequestMoreInfoEmail).
 */
function emailSpamCallout(): string {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0 0;">
    <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#92400e;">Keep an eye on your inbox</p>
      <p style="margin:0;font-size:13px;color:#78350f;line-height:1.5;">Our reply may land in your spam or junk folder. Please add <strong>hello@happyhourcompass.com</strong> to your contacts to make sure you don&rsquo;t miss it.</p>
    </td></tr>
  </table>`;
}

/**
 * "What happens next?" numbered steps panel. Add to review/verification
 * workflows where the recipient submitted something and is waiting for HHC.
 * Do NOT add to password resets, invitations, or activation emails.
 */
function emailWhatHappensNext(steps: string[]): string {
  const rows = steps.map((step, i) => `
        <tr>
          <td style="padding:5px 10px 5px 0;font-size:13px;font-weight:700;color:#d97706;vertical-align:top;white-space:nowrap;">${i + 1}.</td>
          <td style="padding:5px 0;font-size:14px;color:#475569;line-height:1.5;">${step}</td>
        </tr>`).join("");
  return `<table cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.06em;">What happens next?</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${rows}
      </table>
    </td></tr>
  </table>`;
}

// ── Password setup email ───────────────────────────────────────────────────────

/**
 * Sends the approval + password setup email to a newly onboarded operator.
 *
 * `setupLink` is the Supabase-generated action link (from auth.admin.generateLink).
 * When clicked, Supabase verifies the token, creates a session, and redirects
 * to /auth/callback?next=/operator/create-password where the operator sets
 * their password.
 *
 * Link expiry is controlled by the Supabase project's "OTP Expiry" setting
 * (Auth → Configuration in the Supabase dashboard). Set to ≥ 24 hours.
 */
export async function sendPasswordSetupEmail({
  to,
  firstName,
  setupLink,
}: {
  to: string;
  firstName: string;
  setupLink: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Your venue claim was approved</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Great news — your venue ownership claim has been reviewed and approved.
            Click the button below to set your password and access your operator account.
          </p>
          ${emailCta(setupLink, "Set up my password &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires within 24 hours. If it expires, contact us and we can send a new one.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>`,
    "You received this email because you submitted a venue claim on Happy Hour Compass."
  );

  const text = `Hi ${firstName},

Your venue ownership claim on Happy Hour Compass has been approved.

Set up your password to access your operator account:
${setupLink}

This link expires within 24 hours.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "claim_approval",
    to,
    subject:     "Your Happy Hour Compass claim was approved — set up your password",
    html,
    text,
    criticality: "critical",
  });
}

// ── Founder claim notification email ──────────────────────────────────────────

/**
 * Sends a notification email to the founder when a new venue claim is submitted.
 *
 * Required env var:
 *   RESEND_API_KEY
 *
 * Optional env var:
 *   FOUNDER_NOTIFICATION_EMAIL — defaults to hello@happyhourcompass.com
 *   APP_URL                    — used to build the review link
 */
export async function sendClaimNotificationEmail({
  claimId,
  venueName,
  city,
  firstName,
  lastName,
  claimantEmail,
  phone,
  submittedAt,
}: {
  claimId: string;
  venueName: string;
  city?: string | null;
  firstName: string;
  lastName: string;
  claimantEmail: string;
  phone: string;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to = getFounderNotificationEmail();
  const appUrl = getSiteUrl();
  const reviewUrl = `${appUrl}/control-panel/claims/${claimId}`;

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">New venue claim submitted</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Venue</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${venueName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Name</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${firstName} ${lastName}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${claimantEmail}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Phone</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${phone}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitted</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submittedAt}</td>
            </tr>
          </table>
          ${emailCta(reviewUrl, "Review claim &rarr;")}
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>`,
    "Happy Hour Compass &middot; Control Panel notification"
  );

  const text = `New venue claim submitted — Happy Hour Compass

Venue:     ${venueName}
Name:      ${firstName} ${lastName}
Email:     ${claimantEmail}
Phone:     ${phone}
Submitted: ${submittedAt}

Review the claim:
${reviewUrl}

—
Happy Hour Compass Control Panel`;

  const result = await sendTransactionalEmail({
    type:        "claim_notification",
    to,
    subject:     `[Venue Claim] ${venueName}${city ? ` (${city})` : ""}`,
    html,
    text,
    criticality: "important",
  });

  await sendSlackAcquisitionNotification({
    channel: "venue-claims",
    text: `${venueName}${city ? `\n${city}` : ""}\n<${reviewUrl}|Open in Control Panel →>`,
  });

  return result;
}

// ── Claim submission confirmation email (to claimant) ────────────────────────

/**
 * Sends a "we received your claim" acknowledgement to the claimant immediately
 * after they submit the venue claim form.
 *
 * Failure is non-blocking: the claim record already exists. Log and continue.
 */
export async function sendClaimSubmissionConfirmationEmail({
  to,
  firstName,
  venueName,
}: {
  to: string;
  firstName: string;
  venueName: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">We received your claim</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting your ownership claim for <strong style="color:#0f172a;">${venueName}</strong> on Happy Hour Compass.
          </p>
          <p style="margin:0 0 0;font-size:15px;color:#475569;line-height:1.6;">
            We&rsquo;ll review your claim shortly. If we need any additional information, we&rsquo;ll reach out to you at this email address.
          </p>
          ${emailWhatHappensNext([
            "We review your ownership claim (usually within 1&ndash;2 business days).",
            "If we need anything else, we&rsquo;ll reach out to you at this email address.",
            "Once approved, you&rsquo;ll receive a link to set up your operator account.",
          ])}
          <p style="margin:24px 0 4px;font-size:15px;color:#475569;">Cheers,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>`,
    "You received this email because you submitted a venue claim on Happy Hour Compass."
  );

  const text = `Hi ${firstName},

Thanks for submitting your ownership claim for ${venueName} on Happy Hour Compass.

We'll review your claim shortly. If we need any additional information, we'll reach out to you at this email address.

What happens next?
1. We review your ownership claim (usually within 1–2 business days).
2. If we need anything else, we'll reach out to you at this email address.
3. Once approved, you'll receive a link to set up your operator account.

Cheers,
Wayne
Founder, Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "claim_submission_confirmation",
    to,
    subject:     `We received your claim — ${venueName}`,
    html,
    text,
    criticality: "standard",
  });
}

// ── Request more info email ────────────────────────────────────────────────────

/**
 * Sends a professional "more information needed" email to the claimant when
 * the founder selects the Request More Info action during claim review.
 */
export async function sendRequestMoreInfoEmail({
  to,
  firstName,
  venueName,
}: {
  to: string;
  firstName: string;
  venueName: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">More information needed</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hello ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting a request to claim <strong style="color:#0f172a;">${venueName}</strong> on Happy Hour Compass.
          </p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Before we can approve the request, we just need a bit of information to confirm that you&rsquo;re authorized to manage this venue listing.
          </p>
          <p style="margin:0 0 12px;font-size:15px;color:#475569;line-height:1.6;">
            Please reply to this email with one of the following:
          </p>
          <ul style="margin:0 0 16px;padding-left:20px;font-size:15px;color:#475569;line-height:2;">
            <li>a photo of the venue&rsquo;s business licence</li>
            <li>a photo of the venue&rsquo;s liquor licence</li>
            <li>a utility bill showing the business name and address</li>
            <li>an email sent from the venue&rsquo;s official business domain</li>
            <li>confirmation from the venue&rsquo;s website or social media account</li>
          </ul>
          <p style="margin:0 0 0;font-size:15px;color:#475569;line-height:1.6;">
            These documents are used only to verify the claim request and are not stored or shared.
          </p>
          ${emailWhatHappensNext([
            "Reply to this email with one of the verification documents listed above.",
            "We&rsquo;ll review what you send and verify your ownership.",
            "Once verified, you&rsquo;ll receive a link to set up your operator account.",
          ])}
          ${emailSpamCallout()}
          <p style="margin:24px 0 4px;font-size:15px;color:#475569;">Thanks again,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>`,
    "You received this email because you submitted a venue claim on Happy Hour Compass."
  );

  const text = `Hello ${firstName},

Thanks for submitting a request to claim ${venueName} on Happy Hour Compass.

Before we can approve the request, we just need a bit of information to confirm that you're authorized to manage this venue listing.

Please reply to this email with one of the following:

- a photo of the venue's business licence
- a photo of the venue's liquor licence
- a utility bill showing the business name and address
- an email sent from the venue's official business domain
- confirmation from the venue's website or social media account

These documents are used only to verify the claim request and are not stored or shared.

What happens next?
1. Reply to this email with one of the verification documents listed above.
2. We'll review what you send and verify your ownership.
3. Once verified, you'll receive a link to set up your operator account.

Keep an eye on your inbox: Our reply may land in your spam or junk folder. Add hello@happyhourcompass.com to your contacts so you don't miss it.

Thanks again,

Wayne
Founder, Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "claim_more_info_legacy",
    to,
    subject:     "More information needed to verify your venue claim",
    html,
    text,
    criticality: "important",
  });
}

// ── Venue suggestion notification email ───────────────────────────────────────

/**
 * Notifies the founder when a consumer submits a new venue suggestion.
 *
 * Fire-and-forget pattern: email failure must not block the consumer success
 * state. Caller is responsible for not awaiting this in a blocking way.
 *
 * Required env var: RESEND_API_KEY
 * Optional env var: FOUNDER_NOTIFICATION_EMAIL (defaults to hello@happyhourcompass.com)
 */
export async function sendSuggestionNotificationEmail({
  suggestionId,
  venueName,
  city,
  notes,
  customerName,
  customerEmail,
  marketingOptIn,
  submittedAt,
}: {
  suggestionId: string;
  venueName: string;
  city: string;
  notes?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  marketingOptIn?: boolean;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to = getFounderNotificationEmail();
  const notesRow = notes
    ? `<tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Notes</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${notes}</td>
            </tr>`
    : "";
  const customerNameRow = customerName
    ? `<tr${notes ? ' style="background:#f8fafc;"' : ""}>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Name</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${customerName}</td>
            </tr>`
    : "";
  const customerEmailRow = customerEmail
    ? `<tr${(notes || customerName) ? "" : ' style="background:#f8fafc;"'}>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${customerEmail}</td>
            </tr>`
    : "";
  const marketingBadge = customerEmail
    ? `<tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Marketing opt-in</td>
              <td style="padding:10px 14px;border-top:1px solid #e2e8f0;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#ffffff;background:${marketingOptIn ? "#16a34a" : "#64748b"};">${marketingOptIn ? "Yes" : "No"}</span>
              </td>
            </tr>`
    : "";

  const notesText = notes ? `Notes:          ${notes}\n` : "";
  const customerNameText = customerName ? `Name:           ${customerName}\n` : "";
  const customerEmailText = customerEmail ? `Email:          ${customerEmail}\nMarketing opt-in: ${marketingOptIn ? "Yes" : "No"}\n` : "";

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">New happy hour suggestion</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Venue</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${venueName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">City</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${city}</td>
            </tr>
            ${notesRow}
            ${customerNameRow}
            ${customerEmailRow}
            ${marketingBadge}
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitted</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submittedAt}</td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;color:#94a3b8;">Suggestion ID: ${suggestionId}</p>`,
    "Happy Hour Compass &middot; Consumer suggestion notification"
  );

  const text = `New happy hour suggestion — Happy Hour Compass

Venue:     ${venueName}
City:      ${city}
${notesText}${customerNameText}${customerEmailText}Submitted: ${submittedAt}
ID:        ${suggestionId}

—
Happy Hour Compass`;

  const result = await sendTransactionalEmail({
    type:        "suggestion_notification",
    to,
    subject:     `[Venue Suggestion] ${venueName} (${city})`,
    html,
    text,
    criticality: "standard",
  });

  await sendSlackAcquisitionNotification({
    channel: "venue-suggestions",
    text: `${venueName}\n${city}`,
  });

  return result;
}

// ── Venue suggestion confirmation email (to submitter) ───────────────────────

/**
 * Sends a thank-you confirmation email to the consumer who submitted a venue
 * suggestion, if they provided an email address.
 *
 * Copy adapts based on whether the consumer opted in to marketing emails:
 *   - opted in  → acknowledge the opt-in and mention occasional HHC news
 *   - not opted in → purely transactional thank-you, no marketing language
 *
 * Failure is non-blocking: the suggestion record already exists in the DB.
 * Caller should log the error and return success to the consumer regardless.
 */
export async function sendSuggestionConfirmationEmail({
  to,
  venueName,
  customerName,
  marketingOptIn,
}: {
  to: string;
  venueName: string;
  customerName?: string | null;
  marketingOptIn: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";

  const marketingPara = marketingOptIn
    ? `<p style="margin:16px 0 0;font-size:15px;color:#475569;line-height:1.6;">
            Since you opted in, we may also send you occasional updates about your suggestion and Happy Hour Compass news. You can reply to any of our emails to opt out at any time.
          </p>`
    : "";

  const marketingText = marketingOptIn
    ? "\nSince you opted in, we may also send you occasional updates about your suggestion and Happy Hour Compass news. You can reply to any of our emails to opt out at any time."
    : "";

  const html = emailLayout(`
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">Thanks for the suggestion!</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for suggesting <strong style="color:#0f172a;">${venueName}</strong>. We appreciate you helping us make Happy Hour Compass better.
          </p>
          <p style="margin:0 0 0;font-size:15px;color:#475569;line-height:1.6;">
            We&rsquo;ll review the suggestion and may add it to the directory if it looks like a good fit.
          </p>
          ${marketingPara}
          ${emailSpamCallout()}`,
    "You received this email because you suggested a venue on Happy Hour Compass."
  );

  const text = `${greeting}

Thanks for suggesting ${venueName}. We appreciate you helping us make Happy Hour Compass better.

We'll review the suggestion and may add it to the directory if it looks like a good fit.
${marketingText}

Keep an eye on your inbox: Our emails may land in your spam or junk folder. Add hello@happyhourcompass.com to your contacts so you don't miss anything.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "suggestion_confirmation",
    to,
    subject:     "Thanks for your Happy Hour Compass suggestion",
    html,
    text,
    criticality: "standard",
  });
}

// ── Operator submission notification email ────────────────────────────────────

/**
 * Notifies the founder when an operator submits a new business submission via
 * the /suggest/owner flow. Fires after every successful DB insert regardless of
 * match_status (confirmed / rejected / no_match) or Google Places availability.
 *
 * Required env var: RESEND_API_KEY
 * Optional env var: FOUNDER_NOTIFICATION_EMAIL (defaults to hello@happyhourcompass.com)
 */
export async function sendOperatorSubmissionNotificationEmail({
  submissionId,
  businessName,
  city,
  province,
  submitterFirstName,
  submitterLastName,
  submitterEmail,
  matchStatus,
  routedStatus,
  submittedAt,
}: {
  submissionId: string;
  businessName: string;
  city: string;
  province: string;
  submitterFirstName: string;
  submitterLastName: string;
  submitterEmail: string;
  matchStatus: string;
  routedStatus: string;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to = getFounderNotificationEmail();
  const appUrl = getSiteUrl();
  const reviewUrl = `${appUrl}/control-panel/operator-submissions/${submissionId}`;

  const matchBadgeColor =
    matchStatus === "confirmed" ? "#16a34a"
    : matchStatus === "rejected" ? "#dc2626"
    : "#d97706"; // no_match = amber

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">New operator submission</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Business</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${businessName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Location</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${city}, ${province}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitter</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submitterFirstName} ${submitterLastName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submitterEmail}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Match status</td>
              <td style="padding:10px 14px;border-top:1px solid #e2e8f0;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#ffffff;background:${matchBadgeColor};">${matchStatus}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Routed as</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${routedStatus}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitted</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submittedAt}</td>
            </tr>
          </table>
          ${emailCta(reviewUrl, "Review submission &rarr;")}
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>`,
    "Happy Hour Compass &middot; Operator submission notification"
  );

  const text = `New operator submission — Happy Hour Compass

Business:     ${businessName}
Location:     ${city}, ${province}
Submitter:    ${submitterFirstName} ${submitterLastName}
Email:        ${submitterEmail}
Match status: ${matchStatus}
Routed as:    ${routedStatus}
Submitted:    ${submittedAt}

Review the submission:
${reviewUrl}

—
Happy Hour Compass Control Panel`;

  const result = await sendTransactionalEmail({
    type:        "operator_submission_notification",
    to,
    subject:     `[Venue Submission] ${businessName} (${city})`,
    html,
    text,
    criticality: "important",
  });

  await sendSlackAcquisitionNotification({
    channel: "venue-submissions",
    text: `${businessName}\n${city}\n<${reviewUrl}|Open in Control Panel →>`,
  });

  return result;
}

// ── Contact Us — founder notification ────────────────────────────────────────

/**
 * Notifies the founder when a visitor submits the /contact form.
 *
 * This is the primary notification and must succeed before returning success
 * to the caller. If it fails, the caller should return an error to the user.
 *
 * Required env var: RESEND_API_KEY
 * Optional env var: FOUNDER_NOTIFICATION_EMAIL (defaults to hello@happyhourcompass.com)
 */
export async function sendContactFounderNotificationEmail({
  messageId,
  name,
  email,
  message,
  submittedAt,
}: {
  messageId: string;
  name: string | null;
  email: string;
  message: string;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to = getFounderNotificationEmail();
  const nameRow = name
    ? `<tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Name</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${name}</td>
            </tr>`
    : "";
  const nameText = name ? `Name:      ${name}\n` : "";

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">New contact message</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${email}</td>
            </tr>
            ${nameRow}
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitted</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submittedAt}</td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0f172a;">Message:</p>
          <div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;color:#0f172a;line-height:1.6;white-space:pre-wrap;margin-bottom:24px;">${message}</div>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Message ID: ${messageId}</p>`,
    "Happy Hour Compass &middot; Contact form notification"
  );

  const text = `New contact message — Happy Hour Compass

Email:     ${email}
${nameText}Submitted: ${submittedAt}

Message:
${message}

—
Message ID: ${messageId}
Happy Hour Compass`;

  const result = await sendTransactionalEmail({
    type:        "contact_founder_notification",
    to,
    subject:     `[Website Contact] ${name ?? email}`,
    html,
    text,
    criticality: "important",
  });

  await sendSlackAcquisitionNotification({
    channel: "website-contact",
    text: name ? `${name} (${email})` : email,
  });

  return result;
}

// ── Contact Us — submitter confirmation ───────────────────────────────────────

/**
 * Sends a confirmation email to the visitor who submitted the /contact form.
 *
 * Failure is non-blocking: the caller should log the error and still return
 * success to the user (founder notification already succeeded).
 *
 * Required env var: RESEND_API_KEY
 */
export async function sendContactSubmitterConfirmationEmail({
  to,
  name,
}: {
  to: string;
  name: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const greeting = name ? `Hi ${name},` : "Hi there,";

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">We got your message</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 0;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for reaching out to Happy Hour Compass. We&rsquo;ve received your message and will take a look shortly.
          </p>
          ${emailWhatHappensNext([
            "We&rsquo;ll read your message and get back to you as soon as we can.",
            "You&rsquo;ll receive our reply at this email address.",
          ])}
          <p style="margin:24px 0 4px;font-size:15px;color:#475569;">Cheers,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>`,
    "You received this email because you submitted a message on Happy Hour Compass."
  );

  const text = `${greeting}

Thanks for reaching out to Happy Hour Compass. We've received your message and will take a look shortly.

What happens next?
1. We'll read your message and get back to you as soon as we can.
2. You'll receive our reply at this email address.

Cheers,
Wayne
Founder, Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "contact_submitter_confirmation",
    to,
    subject:     "We got your message",
    html,
    text,
    criticality: "standard",
  });
}

// ── Operator submission "request more info" email ─────────────────────────────

/**
 * Asks a venue submitter for additional information needed to verify their
 * submission. Sends a clean CTA with a secure link to the structured more-info
 * form — no internal review notes are exposed to the submitter.
 *
 * Called when the founder clicks "Request more info" on a Needs Review
 * submission in the Control Panel. Must be awaited — not fire-and-forget.
 */
export async function sendOperatorSubmissionMoreInfoEmail({
  to,
  firstName,
  venueName,
  moreInfoUrl,
}: {
  to: string;
  firstName: string;
  venueName: string;
  /** Secure link to the structured more-info form. Expires in 72 hours. */
  moreInfoUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">A few more details needed</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting <strong style="color:#0f172a;">${venueName}</strong> to Happy Hour Compass.
          </p>
          <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
            We weren&rsquo;t able to automatically verify your venue, so we need a few additional details before we can create your operator account. Please click the button below to complete a short verification form — it only takes a couple of minutes.
          </p>
          ${emailCta(moreInfoUrl, "Complete verification &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires in 72 hours. If it expires, reply to this email and we&rsquo;ll send a new one.</p>
          <p style="margin:0 0 0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${moreInfoUrl}</p>
          ${emailWhatHappensNext([
            "Complete the short verification form using the link above.",
            "We&rsquo;ll review the details you provide.",
            "Once verified, you&rsquo;ll receive a link to set up your operator account.",
          ])}
          ${emailSpamCallout()}`,
    "You received this email because you submitted a venue on Happy Hour Compass."
  );

  const text = `Hi ${firstName},

Thanks for submitting ${venueName} to Happy Hour Compass.

We weren't able to automatically verify your venue, so we need a few additional details before we can create your operator account. Please complete a short verification form here:
${moreInfoUrl}

This link expires in 72 hours. If it expires, reply to this email and we'll send a new one.

What happens next?
1. Complete the short verification form using the link above.
2. We'll review the details you provide.
3. Once verified, you'll receive a link to set up your operator account.

Keep an eye on your inbox: Our reply may land in your spam or junk folder. Add hello@happyhourcompass.com to your contacts so you don't miss it.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "operator_submission_more_info",
    to,
    subject:     `More information needed for your venue submission — ${venueName}`,
    html,
    text,
    criticality: "important",
  });
}

// ── Operator submission closure email ─────────────────────────────────────────

/**
 * Notifies a venue submitter that their submission has been reviewed and
 * cannot be accepted at this time. Sent when the founder clicks "Reject / Close".
 *
 * Email failure does NOT block the close action — closure is the primary
 * outcome. Failure is logged and the close action still returns success.
 */
export async function sendOperatorSubmissionClosedEmail({
  to,
  firstName,
  venueName,
}: {
  to: string;
  firstName: string;
  venueName: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">About your submission</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for taking the time to submit <strong style="color:#0f172a;">${venueName}</strong> to Happy Hour Compass.
          </p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            After reviewing your submission, we weren&rsquo;t able to add the venue to our platform at this time. We appreciate your interest and apologise for any inconvenience.
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            If you have additional information that might help, or if you think this decision was made in error, please don&rsquo;t hesitate to reply to this email — we&rsquo;re happy to take another look.
          </p>
          <p style="margin:0 0 4px;font-size:15px;color:#475569;">Thanks again,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>`,
    "You received this email because you submitted a venue on Happy Hour Compass."
  );

  const text = `Hi ${firstName},

Thanks for taking the time to submit ${venueName} to Happy Hour Compass.

After reviewing your submission, we weren't able to add the venue to our platform at this time. We appreciate your interest and apologise for any inconvenience.

If you have additional information that might help, or if you think this decision was made in error, please don't hesitate to reply to this email — we're happy to take another look.

Thanks again,
Wayne
Founder, Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "operator_submission_closed",
    to,
    subject:     `Your Happy Hour Compass submission — ${venueName}`,
    html,
    text,
    criticality: "important",
  });
}

// ── Operator submission confirmation email (to submitter) ─────────────────────

/**
 * Sends a submission received acknowledgement to the operator who submitted via
 * the /suggest/owner flow, for paths where no activation email is sent
 * (pending_review, double_claim, no_match, rejected_by_user).
 *
 * The confirmed_auto path already sends sendOperatorActivationEmail, so this
 * function must not be called for that route.
 *
 * Failure is non-blocking: the submission record already exists.
 */
export async function sendOperatorSubmissionConfirmationEmail({
  to,
  firstName,
  businessName,
}: {
  to: string;
  firstName: string;
  businessName: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">We received your submission</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting <strong style="color:#0f172a;">${businessName}</strong> to Happy Hour Compass.
          </p>
          <p style="margin:0 0 0;font-size:15px;color:#475569;line-height:1.6;">
            We&rsquo;ve received your details and will be in touch to continue setting things up.
          </p>
          ${emailWhatHappensNext([
            "We review your submission (usually within 1&ndash;2 business days).",
            "If we need anything else, we&rsquo;ll reach out to you at this email address.",
            "Once verified, you&rsquo;ll receive a link to set up your operator account.",
          ])}
          <p style="margin:24px 0 4px;font-size:15px;color:#475569;">Cheers,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>`,
    "You received this email because you submitted a venue on Happy Hour Compass."
  );

  const text = `Hi ${firstName},

Thanks for submitting ${businessName} to Happy Hour Compass.

We've received your details and will be in touch to continue setting things up.

What happens next?
1. We review your submission (usually within 1–2 business days).
2. If we need anything else, we'll reach out to you at this email address.
3. Once verified, you'll receive a link to set up your operator account.

Cheers,
Wayne
Founder, Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "operator_submission_confirmation",
    to,
    subject:     `We received your submission — ${businessName}`,
    html,
    text,
    criticality: "standard",
  });
}

// ── Operator submission "info submitted" founder notification ─────────────────

/**
 * Notifies the founder when a submitter completes the structured More Info form
 * and the submission transitions to info_submitted.
 *
 * Non-blocking on failure: the submitter's form completion must not be held
 * hostage to email delivery. Failure is logged and the caller returns success
 * to the submitter regardless.
 *
 * Required env var: RESEND_API_KEY
 * Optional env vars: FOUNDER_NOTIFICATION_EMAIL, APP_URL
 */
export async function sendOperatorSubmissionInfoSubmittedNotificationEmail({
  submissionId,
  businessName,
  submitterFirstName,
  submitterLastName,
  submitterEmail,
  submittedAt,
}: {
  submissionId: string;
  businessName: string;
  submitterFirstName: string;
  submitterLastName: string;
  submitterEmail: string;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to      = getFounderNotificationEmail();
  const appUrl  = getSiteUrl();
  const reviewUrl = `${appUrl}/control-panel/operator-submissions/${submissionId}`;
  const fullName  = [submitterFirstName, submitterLastName].filter(Boolean).join(" ") || submitterEmail;

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Additional information submitted</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Business</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${businessName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitter</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${fullName}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submitterEmail}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Status</td>
              <td style="padding:10px 14px;border-top:1px solid #e2e8f0;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#ffffff;background:#7c3aed;">Info submitted</span>
              </td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitted</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submittedAt}</td>
            </tr>
          </table>
          <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
            The submitter has completed the additional verification form. Open the submission to review their details.
          </p>
          ${emailCta(reviewUrl, "Review submission &rarr;")}
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>`,
    "Happy Hour Compass &middot; Operator submission notification"
  );

  const text = `Additional information submitted — Happy Hour Compass

Business:  ${businessName}
Submitter: ${fullName}
Email:     ${submitterEmail}
Status:    Info submitted
Submitted: ${submittedAt}

The submitter has completed the additional verification form. Review their details:
${reviewUrl}

—
Happy Hour Compass Control Panel`;

  return sendTransactionalEmail({
    type:        "operator_submission_info_submitted",
    to,
    subject:     `Info submitted: ${businessName} — ready for review`,
    html,
    text,
    criticality: "important",
  });
}

// ── Operator activation email (operator submission flow) ─────────────────────

/**
 * Sends an account setup email to an operator whose venue was auto-confirmed
 * via the /suggest/owner submission flow.
 *
 * Copy is intentionally distinct from sendPasswordSetupEmail (claim approval):
 * the submitter is learning their venue was *added* to the platform, not that
 * a *claim* was approved.
 *
 * `setupLink` is the Supabase-generated recovery action link.
 * When clicked, Supabase creates a session and redirects to
 * /operator/create-password where the operator sets their password.
 */
export async function sendOperatorActivationEmail({
  to,
  firstName,
  setupLink,
}: {
  to: string;
  firstName: string;
  setupLink: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Your venue is on Happy Hour Compass</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Your venue has been added to Happy Hour Compass. Click the button below to set up your Operator Admin account and start managing your listing.
          </p>
          ${emailCta(setupLink, "Set up my account &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires within 24 hours. If it expires, contact us and we&rsquo;ll send a new one.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>`,
    "You received this email because you submitted a venue on Happy Hour Compass."
  );

  const text = `Hi ${firstName},

Your venue has been added to Happy Hour Compass.

Set up your Operator Admin account to manage your listing:
${setupLink}

This link expires within 24 hours.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "operator_activation",
    to,
    subject:     "Your venue is on Happy Hour Compass — set up your account",
    html,
    text,
    criticality: "critical",
  });
}

// ── Claim more-info request email ────────────────────────────────────────────

/**
 * Sends a secure tokenised link to a claimant so they can complete the
 * structured verification form at /claim/more-info/[token].
 *
 * Mirrors sendOperatorSubmissionMoreInfoEmail but with claim-specific copy.
 * Token expires in 72 hours. Email failure blocks the "Request more info"
 * action — the founder is told to retry.
 */
export async function sendClaimMoreInfoEmail({
  to,
  firstName,
  venueName,
  moreInfoUrl,
}: {
  to: string;
  firstName: string;
  venueName: string;
  moreInfoUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">A few more details needed</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting your ownership claim for <strong style="color:#0f172a;">${venueName}</strong> on Happy Hour Compass.
          </p>
          <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
            We need a few additional details to verify your ownership before we can grant you access to manage this listing. Please click the button below — it only takes a couple of minutes.
          </p>
          ${emailCta(moreInfoUrl, "Complete verification &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires in 72 hours. If it expires, reply to this email and we&rsquo;ll send a new one.</p>
          <p style="margin:0 0 0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${moreInfoUrl}</p>
          ${emailWhatHappensNext([
            "Complete the short verification form using the link above.",
            "We&rsquo;ll review the details you provide.",
            "Once verified, you&rsquo;ll receive a link to set up your operator account.",
          ])}
          ${emailSpamCallout()}`,
    "You received this email because you submitted a venue claim on Happy Hour Compass."
  );

  const text = `Hi ${firstName},

Thanks for submitting your ownership claim for ${venueName} on Happy Hour Compass.

We need a few additional details to verify your ownership before we can grant you access. Please complete a short verification form here:
${moreInfoUrl}

This link expires in 72 hours. If it expires, reply to this email and we'll send a new one.

What happens next?
1. Complete the short verification form using the link above.
2. We'll review the details you provide.
3. Once verified, you'll receive a link to set up your operator account.

Keep an eye on your inbox: Our reply may land in your spam or junk folder. Add hello@happyhourcompass.com to your contacts so you don't miss it.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "claim_more_info",
    to,
    subject:     `More information needed for your venue claim — ${venueName}`,
    html,
    text,
    criticality: "important",
  });
}

// ── Claim info-submitted founder notification ─────────────────────────────────

/**
 * Notifies the founder that a claimant has completed the structured
 * verification form. Deep-links to the claim detail page.
 *
 * Mirrors sendOperatorSubmissionInfoSubmittedNotificationEmail but for claims.
 */
export async function sendClaimInfoSubmittedNotificationEmail({
  claimId,
  venueName,
  claimantFirstName,
  claimantLastName,
  claimantEmail,
  submittedAt,
}: {
  claimId: string;
  venueName: string;
  claimantFirstName: string;
  claimantLastName: string;
  claimantEmail: string;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to       = getFounderNotificationEmail();
  const appUrl   = getSiteUrl();
  const reviewUrl = `${appUrl}/control-panel/claims/${claimId}`;
  const fullName  = [claimantFirstName, claimantLastName].filter(Boolean).join(" ") || claimantEmail;

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Claim verification submitted</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Venue</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${venueName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Claimant</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${fullName}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${claimantEmail}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Status</td>
              <td style="padding:10px 14px;border-top:1px solid #e2e8f0;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#ffffff;background:#7c3aed;">Info submitted</span>
              </td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitted</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submittedAt}</td>
            </tr>
          </table>
          <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
            The claimant has completed the verification form. Open the claim to review their details.
          </p>
          ${emailCta(reviewUrl, "Review claim &rarr;")}
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>`,
    "Happy Hour Compass &middot; Venue claim notification"
  );

  const text = `Claim verification submitted — Happy Hour Compass

Venue:    ${venueName}
Claimant: ${fullName}
Email:    ${claimantEmail}
Status:   Info submitted
At:       ${submittedAt}

The claimant has completed the verification form. Review their details:
${reviewUrl}

—
Happy Hour Compass Control Panel`;

  return sendTransactionalEmail({
    type:        "claim_info_submitted",
    to,
    subject:     `Info submitted: ${venueName} claim — ready for review`,
    html,
    text,
    criticality: "important",
  });
}

// ── Operator account activated founder notification ────────────────────────────

/**
 * Notifies Happy Hour Compass internally the first time an operator
 * completes account setup (sets their password) — regardless of whether the
 * account originated from a claim approval, an auto-confirmed Add Your Venue
 * submission, or a manually approved Add Your Venue submission.
 *
 * Called at most once per operator by completeOperatorAccountActivation()'s
 * idempotency gate (operators.account_activated_at) — never re-sent on a
 * later self-service password reset.
 */
export async function sendOperatorAccountActivatedNotificationEmail({
  operatorEmail,
  operatorName,
  venueId,
  venueName,
  sourceFlow,
}: {
  operatorEmail: string;
  operatorName: string;
  venueId: string | null;
  venueName: string | null;
  sourceFlow: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to = getFounderNotificationEmail();
  const appUrl = getSiteUrl();
  const reviewUrl = venueId ? `${appUrl}/control-panel/venues/${venueId}` : null;

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Operator account activated</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Operator</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${operatorName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Email</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${operatorEmail}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Venue</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${venueName ?? "Unknown"}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Source</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${sourceFlow}</td>
            </tr>
          </table>
          <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
            This operator has set their password and can now sign in to Operator Admin.
          </p>
          ${reviewUrl ? emailCta(reviewUrl, "View venue &rarr;") : ""}
          ${reviewUrl ? `<p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>` : ""}`,
    "Happy Hour Compass &middot; Operator lifecycle notification"
  );

  const text = `Operator account activated — Happy Hour Compass

Operator: ${operatorName}
Email:    ${operatorEmail}
Venue:    ${venueName ?? "Unknown"}
Source:   ${sourceFlow}

This operator has set their password and can now sign in to Operator Admin.
${reviewUrl ? `\n${reviewUrl}\n` : ""}
—
Happy Hour Compass Control Panel`;

  return sendTransactionalEmail({
    type:        "operator_account_activated",
    to,
    subject:     `Operator account activated: ${operatorName}`,
    html,
    text,
    criticality: "standard",
  });
}

// ── Password reset email ──────────────────────────────────────────────────────

/**
 * Sends a self-service password reset email to an operator who requested it
 * via /forgot-password.
 *
 * Intentionally distinct from sendPasswordSetupEmail (claim approval) and
 * sendOperatorActivationEmail (submission approval):
 *   - No mention of claims, venues, or approvals.
 *   - No personal founder sign-off — purely operational.
 *   - Safe to ignore copy ("If you didn't request this, ignore this email").
 *
 * `resetLink` is the Supabase recovery action link generated by
 * auth.admin.generateLink({ type: 'recovery', ... }).
 */
export async function sendPasswordResetEmail({
  to,
  firstName,
  resetLink,
}: {
  to: string;
  firstName?: string;
  resetLink: string;
}): Promise<{ ok: boolean; error?: string }> {
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Reset your password</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            You requested a password reset for your Happy Hour Compass operator account.
            Click the button below to set a new password.
          </p>
          ${emailCta(resetLink, "Reset my password &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires within 24 hours.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${resetLink}</p>`,
    "If you didn&rsquo;t request a password reset, you can safely ignore this email. Your password will not be changed until you click the link above."
  );

  const text = `${greeting}

You requested a password reset for your Happy Hour Compass operator account.

Reset your password here:
${resetLink}

This link expires within 24 hours.

If you didn't request a password reset, you can safely ignore this email.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "password_reset",
    to,
    subject:     "Reset your Happy Hour Compass password",
    html,
    text,
    criticality: "critical",
  });
}

// ── Member invite email ───────────────────────────────────────────────────────

/**
 * Sends an invitation email to a new team member.
 *
 * The invite link routes to /operator/invite/[token] where the invitee
 * creates their password and accepts access to the venue's operator account.
 *
 * Criticality: "important" — the DB row is already created; email failure
 * rolls back the membership row in the calling action.
 */
export async function sendMemberInviteEmail({
  to,
  firstName,
  venueName,
  inviterName,
  inviteUrl,
}: {
  to: string;
  firstName: string;
  venueName: string;
  inviterName: string;
  inviteUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">You&rsquo;ve been invited to manage ${venueName}</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            <strong style="color:#0f172a;">${inviterName}</strong> has invited you to help manage
            <strong style="color:#0f172a;">${venueName}</strong> on Happy Hour Compass.
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Click the button below to create your password and join the venue&rsquo;s operator account.
          </p>
          ${emailCta(inviteUrl, "Accept invitation &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This invitation link expires in 7 days. If it expires, ask ${inviterName} to send a new invitation.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${inviteUrl}</p>`,
    `You received this email because ${inviterName} invited you to manage a venue on Happy Hour Compass. If you didn&rsquo;t expect this, you can safely ignore it.`
  );

  const text = `Hi ${firstName},

${inviterName} has invited you to help manage ${venueName} on Happy Hour Compass.

Click the link below to create your password and accept the invitation:
${inviteUrl}

This link expires in 7 days. If it expires, ask ${inviterName} to send a new invitation.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "member_invite",
    to,
    subject:     `You've been invited to manage ${venueName} on Happy Hour Compass`,
    html,
    text,
    criticality: "important",
  });
}

// ── Platform admin invite email ───────────────────────────────────────────────

/**
 * Sends an invitation email to a new platform admin (Control Panel access).
 *
 * The invite link routes to /cp-invite/[token] where the invitee creates their
 * password (if new) and their platform_admins row is set to 'active'.
 *
 * Criticality: "critical" — the DB row already exists in 'invited' state.
 * If email fails, the invite record is rolled back in the calling action.
 */
export async function sendPlatformAdminInviteEmail({
  to,
  inviterEmail,
  inviteUrl,
}: {
  to: string;
  inviterEmail: string;
  inviteUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">You&rsquo;ve been invited to the Admin Control Panel</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi,</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            <strong style="color:#0f172a;">${inviterEmail}</strong> has invited you to access the
            Happy Hour Compass Admin Control Panel.
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Click the button below to set up your password and activate your account.
          </p>
          ${emailCta(inviteUrl, "Accept invitation &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This invitation link expires in 7 days.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${inviteUrl}</p>`,
    `You received this email because ${inviterEmail} granted you access to the Happy Hour Compass Admin Control Panel. If you didn&rsquo;t expect this, you can safely ignore it.`
  );

  const text = `Hi,

${inviterEmail} has invited you to access the Happy Hour Compass Admin Control Panel.

Click the link below to set up your password and activate your account:
${inviteUrl}

This link expires in 7 days.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "platform_admin_invite",
    to,
    subject:     "You've been invited to the Happy Hour Compass Admin Control Panel",
    html,
    text,
    criticality: "critical",
  });
}

// ── Venue cancellation founder notification ───────────────────────────────────

export const CANCELLATION_REASON_LABELS: Record<string, string> = {
  business_closed:   "Business closed",
  not_interested:    "Not interested right now",
  duplicate_listing: "Duplicate or incorrect listing",
  not_enough_value:  "Not seeing enough value",
  other:             "Other",
};

/**
 * Notifies the founder when an operator cancels management of their venue.
 *
 * Sent to FOUNDER_NOTIFICATION_EMAIL (defaults to hello@happyhourcompass.com).
 * Includes a direct link to the venue in the Control Panel.
 */
export async function sendVenueCancellationFounderEmail({
  venueName,
  operatorEmail,
  reason,
  venueId,
}: {
  venueName:     string;
  operatorEmail: string;
  reason:        string;
  venueId:       string;
}): Promise<{ ok: boolean; error?: string }> {
  const to      = getFounderNotificationEmail();
  const appUrl  = getSiteUrl();
  const venueUrl = `${appUrl}/control-panel/venues/${venueId}`;
  const reasonLabel = CANCELLATION_REASON_LABELS[reason] ?? reason;

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Operator cancelled venue management</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;width:38%;">Venue</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${venueName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Operator</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${operatorEmail}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Reason</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${reasonLabel}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Timestamp</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${new Date().toUTCString()}</td>
            </tr>
          </table>
          <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
            The venue has been automatically unpublished and removed from the active funnel. Historical data (claims, analytics, notes) is preserved. The venue remains eligible for future reclaiming.
          </p>
          ${emailCta(venueUrl, "View venue in Control Panel &rarr;")}
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${venueUrl}</p>`,
    "Happy Hour Compass &middot; Control Panel notification"
  );

  const text = `Operator cancelled venue management — Happy Hour Compass

Venue:     ${venueName}
Operator:  ${operatorEmail}
Reason:    ${reasonLabel}
Timestamp: ${new Date().toUTCString()}

The venue has been automatically unpublished. Historical data is preserved.

View venue in Control Panel:
${venueUrl}

—
Happy Hour Compass Control Panel`;

  return sendTransactionalEmail({
    type:        "venue_cancellation_founder",
    to,
    subject:     `Operator cancelled venue — ${venueName}`,
    html,
    text,
    criticality: "important",
  });
}

// ── Consumer signup confirmation email ────────────────────────────────────────

/**
 * Sends the branded email-confirmation link to a newly signed-up consumer.
 *
 * `confirmLink` is the Supabase-generated action link (from
 * auth.admin.generateLink({ type: "signup", ... })), built with a redirectTo
 * resolved via getSiteUrl() — the same environment-aware canonical URL
 * already used for operator activation links (see
 * provisionOperatorForVenue in src/lib/operatorActivation.ts) — rather than
 * relying on Supabase Auth's own dashboard-configured Site URL, which does
 * not vary per deployment environment (staging vs. production) the way
 * getSiteUrl() does.
 *
 * Replaces Supabase Auth's default (unbranded) "Confirm signup" email so the
 * consumer signup flow uses the same branded shell as every other HHC
 * transactional email.
 *
 * No spam/junk reminder here — the sign-up success screen already carries
 * that reminder (see emailSpamCallout()'s doc comment: an email that pairs
 * 1:1 with an on-screen confirmation modal should not repeat it).
 *
 * Link expiry is controlled by the Supabase project's "OTP Expiry" setting
 * (Auth → Configuration in the Supabase dashboard).
 */
export async function sendConsumerSignupConfirmationEmail({
  to,
  firstName,
  confirmLink,
}: {
  to: string;
  firstName: string | null;
  confirmLink: string;
}): Promise<{ ok: boolean; error?: string }> {
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const html = emailLayout(`
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Confirm your email</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for creating a Happy Hour Compass account. Click the button below to confirm your email and activate your account.
          </p>
          ${emailCta(confirmLink, "Confirm my email &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires within 24 hours.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${confirmLink}</p>`,
    "You received this email because you created an account on Happy Hour Compass."
  );

  const text = `${greeting}

Thanks for creating a Happy Hour Compass account. Confirm your email to activate your account:
${confirmLink}

This link expires within 24 hours.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "consumer_signup_confirmation",
    to,
    subject:     "Confirm your email — Happy Hour Compass",
    html,
    text,
    criticality: "critical",
  });
}
