import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail, emailLayout, emailCta } from "@/lib/email";
import { generateLinkWithRetry } from "@/lib/supabase/generateLinkWithRetry";
import { getSiteUrl } from "@/lib/siteUrl";
import { reminderIdempotencyKey } from "@/lib/activation/activationReminderPolicy";
import { escapeHtml } from "@/lib/activation/activationEmailEscape";

/**
 * The three reviewed operator-activation reminder email templates
 * (Phase 2A-3). Deliberately kept OUT of any "use server" file — this is a
 * plain module, never network-reachable, so its DI seam (below) carries
 * none of the risk an equivalent parameter would on an exported Server
 * Action. Only the (not-yet-invoked-in-production) reminder orchestrator
 * and its tests ever call sendActivationReminderEmail().
 *
 * LANGUAGE (Phase 2A design correction): these emails state the remaining
 * ACTIVATION WINDOW ("You have N days remaining to finish setting up your
 * account"), never a claim about the SETUP LINK's own lifetime — the
 * Supabase-generated recovery link is documented elsewhere (email.ts) as
 * expiring in as little as ~24 hours, a completely different, much shorter
 * duration than the multi-day activation window. Conflating the two would
 * be factually wrong.
 *
 * A fresh link is generated immediately before every send attempt — never
 * reused or persisted. Nothing in this module ever logs or stores the
 * generated link, its token, or any provider secret.
 */

export type ActivationReminderStage = 1 | 2 | 3;

const DAYS_REMAINING_BY_STAGE: Record<ActivationReminderStage, number> = {
  1: 11,
  2: 7,
  3: 2,
};

function safeFirstName(firstName: string | null | undefined): string {
  return firstName?.trim() || "there";
}

/**
 * Pure template builder — no I/O. Returns the subject/html/text for one
 * reminder stage. Exported separately from the send function so copy can
 * be unit-tested without any Supabase/Resend dependency.
 */
export function buildActivationReminderEmail(
  stage: ActivationReminderStage,
  { firstName, venueName, setupLink }: { firstName: string | null | undefined; venueName: string; setupLink: string }
): { subject: string; html: string; text: string } {
  const name = safeFirstName(firstName);
  const daysRemaining = DAYS_REMAINING_BY_STAGE[stage];
  // Escaped copies for HTML interpolation ONLY — subject and text keep the
  // raw values (a plain-text email/subject should never show "&amp;").
  // setupLink is a URL, never escaped here — see activationEmailEscape.ts.
  const safeName = escapeHtml(name);
  const safeVenueName = escapeHtml(venueName);

  if (stage === 1) {
    const subject = `Finish setting up your ${venueName} account`;
    const html = emailLayout(
      `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Finish setting up your account</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Your ${safeVenueName} listing on Happy Hour Compass is approved, but your operator account isn&rsquo;t set up
            yet &mdash; you won&rsquo;t be able to manage your happy hour details or events until you finish this step.
          </p>
          ${emailCta(setupLink, "Set up your account &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">You have ${daysRemaining} days remaining to finish setting up your account.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>`,
      "You received this email because a venue was approved for your Happy Hour Compass account."
    );
    const text = `Hi ${name},

Your ${venueName} listing on Happy Hour Compass is approved, but your operator account isn't set up yet — you won't be able to manage your happy hour details or events until you finish this step.

Set up your account:
${setupLink}

You have ${daysRemaining} days remaining to finish setting up your account.

—
Happy Hour Compass`;
    return { subject, html, text };
  }

  if (stage === 2) {
    const subject = `Your ${venueName} account setup is still waiting`;
    const html = emailLayout(
      `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Your account setup is still waiting</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            Just a reminder &mdash; your ${safeVenueName} operator account still isn&rsquo;t set up. Nothing about your
            listing has changed, but you&rsquo;ll need to complete this step to manage it.
          </p>
          ${emailCta(setupLink, "Set up your account &rarr;")}
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">You have ${daysRemaining} days remaining to finish setting up your account.</p>
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>`,
      "You received this email because a venue was approved for your Happy Hour Compass account."
    );
    const text = `Hi ${name},

Just a reminder — your ${venueName} operator account still isn't set up. Nothing about your listing has changed, but you'll need to complete this step to manage it.

Set up your account:
${setupLink}

You have ${daysRemaining} days remaining to finish setting up your account.

—
Happy Hour Compass`;
    return { subject, html, text };
  }

  // stage === 3
  const subject = `Final reminder: set up your ${venueName} account`;
  const html = emailLayout(
    `
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">Final reminder</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
            This is the final reminder &mdash; you have ${daysRemaining} days remaining to finish setting up your
            ${safeVenueName} operator account. After that, you&rsquo;ll need to contact us for a new setup link.
          </p>
          ${emailCta(setupLink, "Set up your account &rarr;")}
          <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">Or copy this URL: ${setupLink}</p>`,
    "You received this email because a venue was approved for your Happy Hour Compass account."
  );
  const text = `Hi ${name},

This is the final reminder — you have ${daysRemaining} days remaining to finish setting up your ${venueName} operator account. After that, you'll need to contact us for a new setup link.

Set up your account:
${setupLink}

—
Happy Hour Compass`;
  return { subject, html, text };
}

// ── Send path: fresh link generation + Resend, with idempotency ────────────

type GenerateLinkParams = Parameters<SupabaseClient["auth"]["admin"]["generateLink"]>[0];
type GenerateLinkFn = (supabase: SupabaseClient, params: GenerateLinkParams) => ReturnType<typeof generateLinkWithRetry>;
type SendEmailFn = typeof sendTransactionalEmail;

/** Test-only DI — the real orchestrator always omits these and gets the real implementations. */
export type ActivationReminderEmailDeps = {
  generateLink?: GenerateLinkFn;
  sendEmail?: SendEmailFn;
};

export type ActivationReminderEmailResult =
  | { ok: true; providerMessageId: string | undefined }
  | { ok: false; failedAt: "link_generation" | "send"; error: string };

/**
 * Generates a FRESH setup link immediately before sending — never reused,
 * never persisted, never logged. Uses the deterministic per-(lifecycle,
 * stage) idempotency key so a retry of the SAME stage never double-sends,
 * even if the provider accepted a prior attempt this process never
 * recorded.
 */
export async function sendActivationReminderEmail(
  {
    stage,
    lifecycleId,
    to,
    firstName,
    venueName,
    adminClient,
  }: {
    stage: ActivationReminderStage;
    lifecycleId: string;
    to: string;
    firstName: string | null | undefined;
    venueName: string;
    adminClient: SupabaseClient;
  },
  deps: ActivationReminderEmailDeps = {}
): Promise<ActivationReminderEmailResult> {
  const generateLink = deps.generateLink ?? generateLinkWithRetry;
  const sendEmail = deps.sendEmail ?? sendTransactionalEmail;

  const redirectTo = `${getSiteUrl()}/operator/create-password`;
  const { data: linkData, error: linkError } = await generateLink(adminClient, {
    type: "recovery",
    email: to,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    return { ok: false, failedAt: "link_generation", error: linkError?.message ?? "No action_link returned." };
  }

  const { subject, html, text } = buildActivationReminderEmail(stage, {
    firstName,
    venueName,
    setupLink: linkData.properties.action_link,
  });

  const result = await sendEmail({
    type: "activation_reminder",
    to,
    subject,
    html,
    text,
    // "important" → sendTransactionalEmail's own existing criticality-based
    // escalation posts to #ops-alerts on failure automatically — no
    // separate Slack call is needed here for that purpose.
    criticality: "important",
    idempotencyKey: reminderIdempotencyKey(lifecycleId, stage),
  });

  if (!result.ok) {
    return { ok: false, failedAt: "send", error: result.error ?? "Unknown send error." };
  }

  return { ok: true, providerMessageId: result.id };
}
