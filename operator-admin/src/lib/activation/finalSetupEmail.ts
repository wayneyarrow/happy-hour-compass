import { sendTransactionalEmail, emailLayout, emailCta } from "@/lib/email";
import type { EmailRecordContext } from "@/lib/emailTracking/emailSendRegistry";
import { escapeHtml } from "@/lib/activation/activationEmailEscape";

/**
 * The operator-facing "final setup email" — sent only by the founder's
 * post-expiry "Final resend setup email" action (finalSetupFollowUpImpl.ts),
 * after automatic setup reminders have ended without account setup.
 *
 * Setup wording, never "reset": this operator has never chosen a password.
 * The link is a scanner-safe token_hash recovery link to
 * /operator/create-password?…&intent=setup (the page waits for an explicit
 * "Continue" click before verifying anything). It is a Supabase recovery
 * link, so it expires 24 hours after it was generated and replaces any
 * earlier setup link — the copy says both.
 *
 * Email type `activation_final_setup` is in NEVER_TRACKED_SENDER_EMAIL_TYPES
 * (it carries a credential link), so it is always sent from the root domain
 * with no open-tracking pixel. Nothing here logs or stores the link.
 */

export const FINAL_SETUP_EMAIL_TYPE = "activation_final_setup";

export function buildFinalSetupEmail({
  firstName,
  venueName,
  setupLink,
}: {
  firstName: string | null | undefined;
  venueName: string;
  setupLink: string;
}): { subject: string; html: string; text: string } {
  const name = firstName?.trim() || "there";
  const safeName = escapeHtml(name);
  const safeVenueName = escapeHtml(venueName);

  const subject = `Finish setting up your ${venueName} account on Happy Hour Compass`;

  const html = emailLayout(
    `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Finish setting up your account</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Your ${safeVenueName} listing on Happy Hour Compass is approved, and the only step left is choosing a
            password for your account. Once you&rsquo;re in, you can keep your happy hour details and events up to
            date for the people finding ${safeVenueName}.
          </p>
          ${emailCta(setupLink, "Finish your setup &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">
            This link expires in 24 hours and replaces any earlier setup link we&rsquo;ve sent. If it expires, just
            reply to this email and we&rsquo;ll send a new one.
          </p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>`,
    `You received this email because ${safeVenueName} was claimed or added on Happy Hour Compass with this email address.`
  );

  const text = `Hi ${name},

Your ${venueName} listing on Happy Hour Compass is approved, and the only step left is choosing a password for your account. Once you're in, you can keep your happy hour details and events up to date for the people finding ${venueName}.

Finish your setup:
${setupLink}

This link expires in 24 hours and replaces any earlier setup link we've sent. If it expires, just reply to this email and we'll send a new one.

—
Happy Hour Compass`;

  return { subject, html, text };
}

export async function sendFinalSetupEmail(
  {
    to,
    firstName,
    venueName,
    setupLink,
    record,
  }: {
    to: string;
    firstName: string | null | undefined;
    venueName: string;
    setupLink: string;
    record: EmailRecordContext;
  },
  deps: { sendEmail?: typeof sendTransactionalEmail } = {}
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { subject, html, text } = buildFinalSetupEmail({ firstName, venueName, setupLink });
  return (deps.sendEmail ?? sendTransactionalEmail)({
    type: FINAL_SETUP_EMAIL_TYPE,
    to,
    subject,
    html,
    text,
    // "important" → sendTransactionalEmail's existing escalation posts a
    // provider failure to #ops-alerts automatically.
    criticality: "important",
    record,
  });
}
