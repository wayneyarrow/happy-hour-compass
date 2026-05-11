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
  const from = DEFAULT_FROM;

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

  console.log("[EMAIL] sendPasswordSetupEmail — attempting send", { to, from, flow: "password-setup" });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: "Your Happy Hour Compass claim was approved — set up your password",
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendPasswordSetupEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendPasswordSetupEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendPasswordSetupEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const from = DEFAULT_FROM;

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

  console.log("[EMAIL] sendClaimNotificationEmail — attempting send", { to, from, flow: "claim-notification", claimId, venueName });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `New claim: ${venueName} — ${firstName} ${lastName}`,
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendClaimNotificationEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendClaimNotificationEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendClaimNotificationEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const from = DEFAULT_FROM;

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

  console.log("[EMAIL] sendRequestMoreInfoEmail — attempting send", { to, from, flow: "request-more-info", venueName });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: "More information needed to verify your venue claim",
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendRequestMoreInfoEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendRequestMoreInfoEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendRequestMoreInfoEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const from = DEFAULT_FROM;

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

  console.log("[EMAIL] sendSuggestionNotificationEmail — attempting send", { to, from, flow: "suggestion-notification", venueName, city });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `New happy hour suggestion: ${venueName} (${city})`,
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendSuggestionNotificationEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendSuggestionNotificationEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendSuggestionNotificationEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const to = process.env.FOUNDER_NOTIFICATION_EMAIL ?? "wayne.yarrow@gmail.com";
  const from = DEFAULT_FROM;
  const appUrl = getAppUrl();
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

  console.log("[EMAIL] sendOperatorSubmissionNotificationEmail — attempting send", {
    to,
    from,
    flow: "operator-submission-notification",
    businessName,
    matchStatus,
    routedStatus,
  });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `New operator submission: ${businessName} (${city}) — ${matchStatus}`,
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendOperatorSubmissionNotificationEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendOperatorSubmissionNotificationEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendOperatorSubmissionNotificationEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const from = DEFAULT_FROM;

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

  console.log("[EMAIL] sendContactFounderNotificationEmail — attempting send", { to, from, flow: "contact-founder", messageId });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `New contact message from ${name ?? email}`,
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendContactFounderNotificationEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendContactFounderNotificationEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendContactFounderNotificationEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const from = DEFAULT_FROM;
  const greeting = name ? `Hi ${name},` : "Hi there,";

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

  console.log("[EMAIL] sendContactSubmitterConfirmationEmail — attempting send", { to, from, flow: "contact-submitter-confirmation" });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: "We got your message",
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendContactSubmitterConfirmationEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendContactSubmitterConfirmationEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendContactSubmitterConfirmationEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const from = DEFAULT_FROM;

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

  console.log("[EMAIL] sendOperatorActivationEmail — attempting send", { to, from, flow: "operator-activation" });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: "Your venue is on Happy Hour Compass — set up your account",
      html,
      text,
    });

    if (error) {
      console.error("[EMAIL] sendOperatorActivationEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendOperatorActivationEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendOperatorActivationEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
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
  const from = DEFAULT_FROM;

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

  console.log("[EMAIL] sendApprovalEmail — attempting send", { to, from, flow: "approval-legacy" });

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({ from, to, subject: "Your Happy Hour Compass claim was approved", html, text });

    if (error) {
      console.error("[EMAIL] sendApprovalEmail — Resend returned error:", error);
      return { ok: false, error: error.message };
    }

    console.log("[EMAIL] sendApprovalEmail — sent successfully", { id: data?.id });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EMAIL] sendApprovalEmail — unexpected exception:", msg);
    return { ok: false, error: msg };
  }
}
