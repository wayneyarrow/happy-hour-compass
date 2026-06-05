/**
 * Email utility — server-side only.
 *
 * Uses Resend (https://resend.com) as the sending provider.
 *
 * Required env vars:
 *   RESEND_API_KEY   — from your Resend dashboard (resend.com/api-keys)
 *
 * Optional env var (for the activation link base URL):
 *   APP_URL          — e.g. "https://happyhourcompass.com"
 *                      Falls back to VERCEL_URL (auto-set by Vercel) or localhost.
 *
 * Sender: hello@happyhourcompass.com (verified domain).
 *
 * Resend free tier: 3,000 emails/month, 100/day.
 */

import { Resend } from "resend";
import { sendSlackAlert } from "@/lib/slack";

// ── Config ────────────────────────────────────────────────────────────────────

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Your venue claim was approved</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Great news — your venue ownership claim has been reviewed and approved.
            Click the button below to set your password and access your operator account.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${setupLink}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Set up my password →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires within 24 hours. If it expires, contact us and we can send a new one.</p>
          <p style="margin:0 0 24px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue claim on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
 *   FOUNDER_NOTIFICATION_EMAIL — defaults to wayne.yarrow@gmail.com
 *   APP_URL                    — used to build the review link
 */
export async function sendClaimNotificationEmail({
  claimId,
  venueName,
  firstName,
  lastName,
  claimantEmail,
  phone,
  submittedAt,
}: {
  claimId: string;
  venueName: string;
  firstName: string;
  lastName: string;
  claimantEmail: string;
  phone: string;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to =
    process.env.FOUNDER_NOTIFICATION_EMAIL ?? "wayne.yarrow@gmail.com";
  const appUrl = getAppUrl();
  const reviewUrl = `${appUrl}/control-panel/claims/${claimId}`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${reviewUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Review claim →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Happy Hour Compass · Control Panel notification</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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

  return sendTransactionalEmail({
    type:        "claim_notification",
    to,
    subject:     `New claim: ${venueName} — ${firstName} ${lastName}`,
    html,
    text,
    criticality: "important",
  });
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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">We received your claim</h1>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting your ownership claim for <strong style="color:#0f172a;">${venueName}</strong> on Happy Hour Compass.
          </p>

          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            We&rsquo;ll review your claim shortly. If we need any additional information, we&rsquo;ll reach out to you at this email address.
          </p>

          <p style="margin:0 0 4px;font-size:15px;color:#475569;">Cheers,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 20px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue claim on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${firstName},

Thanks for submitting your ownership claim for ${venueName} on Happy Hour Compass.

We'll review your claim shortly. If we need any additional information, we'll reach out to you at this email address.

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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

          <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;color:#475569;line-height:2;">
            <li>a photo of the venue&rsquo;s business licence</li>
            <li>a photo of the venue&rsquo;s liquor licence</li>
            <li>a utility bill showing the business name and address</li>
            <li>an email sent from the venue&rsquo;s official business domain</li>
            <li>confirmation from the venue&rsquo;s website or social media account</li>
          </ul>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            These documents are used only to verify the claim request and are not stored or shared.
          </p>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Once we receive the information, we&rsquo;ll review the request and get your venue set up as quickly as possible.
          </p>

          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            If you have any questions, feel free to reply directly to this email.
          </p>

          <p style="margin:0 0 4px;font-size:15px;color:#475569;">Thanks again,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 20px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue claim on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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

Once we receive the information, we'll review the request and get your venue set up as quickly as possible.

If you have any questions, feel free to reply directly to this email.

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
 * Optional env var: FOUNDER_NOTIFICATION_EMAIL (defaults to wayne.yarrow@gmail.com)
 */
export async function sendSuggestionNotificationEmail({
  suggestionId,
  venueName,
  city,
  notes,
  submittedAt,
}: {
  suggestionId: string;
  venueName: string;
  city: string;
  notes?: string;
  submittedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const to =
    process.env.FOUNDER_NOTIFICATION_EMAIL ?? "wayne.yarrow@gmail.com";
  const notesRow = notes
    ? `<tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Notes</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${notes}</td>
            </tr>`
    : "";

  const notesText = notes ? `Notes:     ${notes}\n` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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
            <tr${notes ? "" : ' style="background:#f8fafc;"'}>
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Submitted</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${submittedAt}</td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">Suggestion ID: ${suggestionId}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Happy Hour Compass · Consumer suggestion notification</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `New happy hour suggestion — Happy Hour Compass

Venue:     ${venueName}
City:      ${city}
${notesText}Submitted: ${submittedAt}
ID:        ${suggestionId}

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "suggestion_notification",
    to,
    subject:     `New happy hour suggestion: ${venueName} (${city})`,
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
 * Optional env var: FOUNDER_NOTIFICATION_EMAIL (defaults to wayne.yarrow@gmail.com)
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
  const to = process.env.FOUNDER_NOTIFICATION_EMAIL ?? "wayne.yarrow@gmail.com";  const appUrl = getAppUrl();
  const reviewUrl = `${appUrl}/control-panel/operator-submissions/${submissionId}`;

  const matchBadgeColor =
    matchStatus === "confirmed" ? "#16a34a"
    : matchStatus === "rejected" ? "#dc2626"
    : "#d97706"; // no_match = amber

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${reviewUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Review submission →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Happy Hour Compass · Operator submission notification</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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

  return sendTransactionalEmail({
    type:        "operator_submission_notification",
    to,
    subject:     `New operator submission: ${businessName} (${city}) — ${matchStatus}`,
    html,
    text,
    criticality: "important",
  });
}

// ── Contact Us — founder notification ────────────────────────────────────────

/**
 * Notifies the founder when a visitor submits the /contact form.
 *
 * This is the primary notification and must succeed before returning success
 * to the caller. If it fails, the caller should return an error to the user.
 *
 * Required env var: RESEND_API_KEY
 * Optional env var: FOUNDER_NOTIFICATION_EMAIL (defaults to wayne.yarrow@gmail.com)
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
  const to = process.env.FOUNDER_NOTIFICATION_EMAIL ?? "wayne.yarrow@gmail.com";
  const nameRow = name
    ? `<tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#64748b;border-top:1px solid #e2e8f0;">Name</td>
              <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${name}</td>
            </tr>`
    : "";
  const nameText = name ? `Name:      ${name}\n` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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
          <p style="margin:0 0 8px;font-size:12px;color:#cbd5e1;word-break:break-all;">Message ID: ${messageId}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Happy Hour Compass · Contact form notification</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `New contact message — Happy Hour Compass

Email:     ${email}
${nameText}Submitted: ${submittedAt}

Message:
${message}

—
Message ID: ${messageId}
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "contact_founder_notification",
    to,
    subject:     `New contact message from ${name ?? email}`,
    html,
    text,
    criticality: "important",
  });
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
}): Promise<{ ok: boolean; error?: string }> {  const greeting = name ? `Hi ${name},` : "Hi there,";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">We got your message</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for reaching out to Happy Hour Compass. We&rsquo;ve received your message and will take a look shortly.
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            If you have anything to add, feel free to reply directly to this email.
          </p>
          <p style="margin:0 0 4px;font-size:15px;color:#475569;">Cheers,</p>
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Wayne</p>
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 20px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a message on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${greeting}

Thanks for reaching out to Happy Hour Compass. We've received your message and will take a look shortly.

If you have anything to add, feel free to reply directly to this email.

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">A few more details needed</h1>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting <strong style="color:#0f172a;">${venueName}</strong> to Happy Hour Compass.
          </p>

          <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
            We weren&rsquo;t able to automatically verify your venue, so we need a few additional details before we can create your operator account. Please click the button below to complete a short verification form — it only takes a couple of minutes.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${moreInfoUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Complete verification →
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;font-size:12px;color:#94a3b8;">This link expires in 72 hours. If it expires, reply to this email and we&rsquo;ll send a new one.</p>

          <p style="margin:0 0 8px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${moreInfoUrl}</p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 20px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${firstName},

Thanks for submitting ${venueName} to Happy Hour Compass.

We weren't able to automatically verify your venue, so we need a few additional details before we can create your operator account. Please complete a short verification form here:
${moreInfoUrl}

This link expires in 72 hours. If it expires, reply to this email and we'll send a new one.

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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
          <p style="margin:0;font-size:14px;color:#64748b;">Founder, Happy Hour Compass</p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 20px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const to      = process.env.FOUNDER_NOTIFICATION_EMAIL ?? "wayne.yarrow@gmail.com";
  const from    = DEFAULT_FROM;
  const appUrl  = getAppUrl();
  const reviewUrl = `${appUrl}/control-panel/operator-submissions/${submissionId}`;
  const fullName  = [submitterFirstName, submitterLastName].filter(Boolean).join(" ") || submitterEmail;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${reviewUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Review submission →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Happy Hour Compass · Operator submission notification</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Your venue is on Happy Hour Compass</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Your venue has been added to Happy Hour Compass. Click the button below to set up your Operator Admin account and start managing your listing.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${setupLink}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Set up my account →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires within 24 hours. If it expires, contact us and we&rsquo;ll send a new one.</p>
          <p style="margin:0 0 24px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">A few more details needed</h1>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            Thanks for submitting your ownership claim for <strong style="color:#0f172a;">${venueName}</strong> on Happy Hour Compass.
          </p>

          <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
            We need a few additional details to verify your ownership before we can grant you access to manage this listing. Please click the button below — it only takes a couple of minutes.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${moreInfoUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Complete verification →
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;font-size:12px;color:#94a3b8;">This link expires in 72 hours. If it expires, reply to this email and we&rsquo;ll send a new one.</p>

          <p style="margin:0 0 8px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${moreInfoUrl}</p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 20px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue claim on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${firstName},

Thanks for submitting your ownership claim for ${venueName} on Happy Hour Compass.

We need a few additional details to verify your ownership before we can grant you access. Please complete a short verification form here:
${moreInfoUrl}

This link expires in 72 hours. If it expires, reply to this email and we'll send a new one.

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
  const to       = process.env.FOUNDER_NOTIFICATION_EMAIL ?? "wayne.yarrow@gmail.com";
  const from     = DEFAULT_FROM;
  const appUrl   = getAppUrl();
  const reviewUrl = `${appUrl}/control-panel/claims/${claimId}`;
  const fullName  = [claimantFirstName, claimantLastName].filter(Boolean).join(" ") || claimantEmail;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
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
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${reviewUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Review claim →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy: ${reviewUrl}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Happy Hour Compass · Venue claim notification</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
}): Promise<{ ok: boolean; error?: string }> {  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Reset your password</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            You requested a password reset for your Happy Hour Compass operator account.
            Click the button below to set a new password.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${resetLink}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Reset my password →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires within 24 hours.</p>
          <p style="margin:0 0 24px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${resetLink}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            If you didn&rsquo;t request a password reset, you can safely ignore this email.
            Your password will not be changed until you click the link above.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">You&rsquo;ve been invited to manage ${venueName}</h1>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>

          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">
            <strong style="color:#0f172a;">${inviterName}</strong> has invited you to help manage
            <strong style="color:#0f172a;">${venueName}</strong> on Happy Hour Compass.
          </p>

          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Click the button below to create your password and join the venue&rsquo;s operator account.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${inviteUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Accept invitation &rarr;
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This invitation link expires in 7 days. If it expires, ask ${inviterName} to send a new invitation.</p>
          <p style="margin:0 0 24px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${inviteUrl}</p>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because ${inviterName} invited you to manage a venue on Happy Hour Compass.
            If you didn&rsquo;t expect this, you can safely ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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

// ── Approval email (legacy — superseded by sendPasswordSetupEmail) ─────────────

export async function sendApprovalEmail({
  to,
  firstName,
  token,
}: {
  to: string;
  firstName: string;
  token: string;
}): Promise<{ ok: boolean; error?: string }> {
  const appUrl = getAppUrl();
  const activateUrl = `${appUrl}/activate-account?token=${token}`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.05em;">Happy Hour Compass</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Your venue claim was approved</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Great news — your venue ownership claim has been reviewed and approved.
            Click the button below to create your operator account and take control of your listing.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#d97706;border-radius:8px;">
              <a href="${activateUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Create my account →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">This link expires in 7 days. If it expires, contact us and we can send a new one.</p>
          <p style="margin:0 0 24px;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${activateUrl}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            You received this email because you submitted a venue claim on Happy Hour Compass.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${firstName},

Your venue ownership claim on Happy Hour Compass has been approved.

Create your operator account here:
${activateUrl}

This link expires in 7 days.

—
Happy Hour Compass`;

  return sendTransactionalEmail({
    type:        "claim_approval_legacy",
    to,
    subject:     "Your Happy Hour Compass claim was approved",
    html,
    text,
    criticality: "standard",
  });
}
