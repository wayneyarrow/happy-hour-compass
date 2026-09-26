import { sendTransactionalEmail, emailLayout, emailCta } from "@/lib/email";
import { escapeHtml } from "@/lib/activation/activationEmailEscape";

/**
 * Operator email-code activation emails (email-code initiative, Phase 2B).
 * Reuses the shared HHC transactional shell (emailLayout/emailCta) and the
 * one send path (sendTransactionalEmail) — no separate email system.
 *
 *   Code email — the six-digit code, sent ONLY after
 *     issue_operator_verification_code() returns 'issued' (see
 *     emailCodeVerificationService.ts). The plaintext code exists only in
 *     the rendered subject/body handed to the provider; nothing here logs
 *     or stores it.
 *
 *   Continue-setup email — replaces the legacy "set up my password"
 *     Supabase-link email for verification-required lifecycles. It links
 *     to /operator/verify (an HHC page), not to a Supabase token, and makes
 *     no claim about the link's own lifetime: the page stays usable for the
 *     whole activation window.
 *
 * Builders are pure (no I/O) so copy is unit-testable without Resend.
 */

type SendEmailFn = typeof sendTransactionalEmail;

function safeFirstName(firstName: string | null | undefined): string {
  return firstName?.trim() || "there";
}

// ── Code email ───────────────────────────────────────────────────────────────

export function buildVerificationCodeEmail({
  firstName,
  code,
  expiresInMinutes,
  continueUrl,
}: {
  firstName: string | null | undefined;
  code: string;
  expiresInMinutes: number;
  continueUrl: string;
}): { subject: string; html: string; text: string } {
  const name = safeFirstName(firstName);
  const subject = `${code} is your Happy Hour Compass verification code`;
  const html = emailLayout(
    `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Your verification code</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${escapeHtml(name)},</p>
          <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
            Enter this code on Happy Hour Compass to verify your email and continue setting up your venue account.
          </p>
          <p style="margin:0 0 20px;padding:16px 0;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:32px;font-weight:700;letter-spacing:0.3em;color:#0f172a;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${code}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#94a3b8;">This code expires in ${expiresInMinutes} minutes.</p>
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">Closed the page? <a href="${continueUrl}" style="color:#d97706;text-decoration:none;">Continue your setup here</a>.</p>
          <p style="margin:0;font-size:13px;color:#94a3b8;">If you didn&rsquo;t start setting up a venue on Happy Hour Compass, you can safely ignore this email.</p>`,
    "You received this email because someone started setting up a venue account on Happy Hour Compass with this address."
  );
  const text = `Hi ${name},

Enter this code on Happy Hour Compass to verify your email and continue setting up your venue account:

${code}

This code expires in ${expiresInMinutes} minutes.

Closed the page? Continue your setup here:
${continueUrl}

If you didn't start setting up a venue on Happy Hour Compass, you can safely ignore this email.

—
Happy Hour Compass`;
  return { subject, html, text };
}

export async function sendVerificationCodeEmail(
  params: {
    to: string;
    firstName: string | null | undefined;
    code: string;
    expiresInMinutes: number;
    continueUrl: string;
    /** One key per issued code row, so a retried send of the SAME code can never duplicate. */
    idempotencyKey: string;
  },
  sendEmail: SendEmailFn = sendTransactionalEmail
): Promise<{ ok: boolean; error?: string }> {
  const { subject, html, text } = buildVerificationCodeEmail(params);
  return sendEmail({
    type: "operator_verification_code",
    to: params.to,
    subject,
    html,
    text,
    // Critical, like the legacy setup email it replaces: an operator who
    // never receives the code cannot finish activation.
    criticality: "critical",
    idempotencyKey: params.idempotencyKey,
  });
}

// ── Continue-setup email ─────────────────────────────────────────────────────

export type ContinueSetupOrigin = "claim" | "submission";

export function buildContinueSetupEmail({
  origin,
  firstName,
  continueUrl,
}: {
  origin: ContinueSetupOrigin;
  firstName: string | null | undefined;
  continueUrl: string;
}): { subject: string; html: string; text: string } {
  const name = safeFirstName(firstName);
  const isClaim = origin === "claim";
  const heading = isClaim ? "Your venue claim was approved" : "Your venue is on Happy Hour Compass";
  const lead = isClaim
    ? "Great news — your venue ownership claim has been reviewed and approved."
    : "Your venue has been added to Happy Hour Compass.";
  const subject = isClaim
    ? "Your Happy Hour Compass claim was approved — finish setting up your account"
    : "Your venue is on Happy Hour Compass — finish setting up your account";
  const footer = isClaim
    ? "You received this email because you submitted a venue claim on Happy Hour Compass."
    : "You received this email because you submitted a venue on Happy Hour Compass.";

  const html = emailLayout(
    `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">${heading}</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${escapeHtml(name)},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            ${lead} Continue on Happy Hour Compass to verify your email with a short code and set up your Operator Admin account.
          </p>
          ${emailCta(continueUrl, "Finish setting up my account &rarr;")}
          <p style="margin:20px 0 4px;font-size:12px;color:#94a3b8;line-height:1.5;">Button not working? Copy and paste this link into your browser:</p>
          <p style="margin:0;font-size:11px;line-height:1.5;word-break:break-all;overflow-wrap:anywhere;"><a href="${continueUrl}" style="color:#94a3b8;text-decoration:underline;">${continueUrl}</a></p>`,
    footer
  );
  const text = `Hi ${name},

${lead} Continue on Happy Hour Compass to verify your email with a short code and set up your Operator Admin account:
${continueUrl}

—
Happy Hour Compass`;
  return { subject, html, text };
}

export async function sendContinueSetupEmail(
  params: { to: string; firstName: string | null | undefined; origin: ContinueSetupOrigin; continueUrl: string },
  sendEmail: SendEmailFn = sendTransactionalEmail
): Promise<{ ok: boolean; error?: string }> {
  const { subject, html, text } = buildContinueSetupEmail(params);
  return sendEmail({
    // Same type/criticality as the legacy email each origin replaces, so
    // existing escalation (#ops-critical on failure) is unchanged.
    type: params.origin === "claim" ? "claim_approval" : "operator_activation",
    to: params.to,
    subject,
    html,
    text,
    criticality: "critical",
  });
}
