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
 * Sender: always uses onboarding@resend.dev (Resend's shared sender, no domain
 * verification required). Switch to a verified domain when ready by updating
 * DEFAULT_FROM below.
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
  if (!key) throw new Error("RESEND_API_KEY env var is not set.");
  return new Resend(key);
}

const DEFAULT_FROM = "Happy Hour Compass <onboarding@resend.dev>";

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

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Your Happy Hour Compass claim was approved — set up your password",
      html,
      text,
    });

    if (error) {
      console.error("[sendPasswordSetupEmail] Resend error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sendPasswordSetupEmail] Unexpected error:", msg);
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

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `New claim: ${venueName} — ${firstName} ${lastName}`,
      html,
      text,
    });

    if (error) {
      console.error("[sendClaimNotificationEmail] Resend error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sendClaimNotificationEmail] Unexpected error:", msg);
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

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "More information needed to verify your venue claim",
      html,
      text,
    });

    if (error) {
      console.error("[sendRequestMoreInfoEmail] Resend error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sendRequestMoreInfoEmail] Unexpected error:", msg);
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

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `New happy hour suggestion: ${venueName} (${city})`,
      html,
      text,
    });

    if (error) {
      console.error("[sendSuggestionNotificationEmail] Resend error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sendSuggestionNotificationEmail] Unexpected error:", msg);
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

  try {
    const resend = getResend();
    const { error } = await resend.emails.send({ from, to, subject: "Your Happy Hour Compass claim was approved", html, text });

    if (error) {
      console.error("[sendApprovalEmail] Resend error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sendApprovalEmail] Unexpected error:", msg);
    return { ok: false, error: msg };
  }
}
