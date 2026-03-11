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

// ── Approval email ─────────────────────────────────────────────────────────────

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
