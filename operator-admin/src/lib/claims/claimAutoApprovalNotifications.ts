import { sendTransactionalEmail, emailLayout, emailCta, getFounderNotificationEmail } from "@/lib/email";
import { sendSlackAcquisitionNotification } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { escapeHtml } from "@/lib/activation/activationEmailEscape";
import type { ClaimAutoApprovalDecision } from "./claimAutoApprovalPolicy";

/**
 * Founder notification for an AUTO-APPROVED claim: email + #venue-claims
 * Slack, both unmistakably labelled "CLAIM AUTO-APPROVED", in plain English
 * (reason codes stay in the claim note's metadata, never here).
 *
 * Builders are pure so the content can be tested without a provider.
 */

export type AutoApprovedClaimContext = {
  claimId: string;
  venueName: string;
  city: string | null;
  claimant: { firstName: string; lastName: string; email: string; phone: string; role: string };
  decision: ClaimAutoApprovalDecision;
  /** "new_operator_in_flow" = code sent, operator verifying now; "returning_operator" = existing account, signed in via /login. */
  nextStep: "new_operator_in_flow" | "returning_operator" | "new_operator_email";
  activationDeadline?: string | null;
};

function nextStepText(ctx: AutoApprovedClaimContext): string {
  if (ctx.nextStep === "returning_operator") {
    return "Existing activated operator — the venue was added to their account and they were sent to sign in. No new activation needed. Venue is publicly verified.";
  }
  const deadline = ctx.activationDeadline
    ? ` Activation deadline: ${new Date(ctx.activationDeadline).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium" })}.`
    : "";
  if (ctx.nextStep === "new_operator_email") {
    return `Operator account created; setup continues by email.${deadline} The venue becomes publicly verified when they finish activation.`;
  }
  return `Operator account created and a verification code was sent — they're verifying their email in HHC now.${deadline} The venue becomes publicly verified when they finish activation.`;
}

export function buildAutoApprovedClaimNotification(ctx: AutoApprovedClaimContext) {
  const reviewUrl = `${getSiteUrl()}/control-panel/claims/${ctx.claimId}`;
  const where = `${ctx.venueName}${ctx.city ? ` (${ctx.city})` : ""}`;
  const name = `${ctx.claimant.firstName} ${ctx.claimant.lastName}`.trim();
  const why = ctx.decision.humanReasons;
  const noted = ctx.decision.cautions.map((c) => c.explanation);
  const supporting = ctx.decision.supporting.map((s) => s.explanation);
  const next = nextStepText(ctx);

  const subject = `[CLAIM AUTO-APPROVED] ${where}`;

  const li = (items: string[]) => items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const section = (title: string, items: string[], tone: "green" | "amber" | "slate") => {
    if (items.length === 0) return "";
    const colors = { green: ["#f0fdf4", "#bbf7d0", "#166534"], amber: ["#fffbeb", "#fde68a", "#92400e"], slate: ["#f8fafc", "#e2e8f0", "#334155"] }[tone];
    return `<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;background:${colors[0]};border:1px solid ${colors[1]};border-radius:8px;">
            <tr><td style="padding:12px 16px;">
              <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${colors[2]};">${title}</p>
              <ul style="margin:0;padding-left:18px;font-size:14px;color:${colors[2]};line-height:1.6;">${li(items)}</ul>
            </td></tr>
          </table>`;
  };
  const row = (label: string, value: string, shade: boolean) =>
    `<tr${shade ? ' style="background:#f8fafc;"' : ""}><td style="padding:9px 14px;font-size:12px;font-weight:600;color:#64748b;width:32%;border-top:1px solid #e2e8f0;">${label}</td><td style="padding:9px 14px;font-size:14px;color:#0f172a;border-top:1px solid #e2e8f0;">${escapeHtml(value)}</td></tr>`;

  const html = emailLayout(
    `
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.08em;color:#16a34a;">CLAIM AUTO-APPROVED</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;">${escapeHtml(where)}</h1>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            ${row("Claimant", name, true)}
            ${row("Role", ctx.claimant.role, false)}
            ${row("Email", ctx.claimant.email, true)}
            ${row("Phone", ctx.claimant.phone, false)}
            ${row("Decision", "Auto-approved (no founder review needed)", true)}
          </table>
          ${section("Why it auto-approved", why, "green")}
          ${section("Also noted (not enough to require review)", noted, "amber")}
          ${section("Supporting context", supporting, "slate")}
          <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;"><strong>Next step:</strong> ${escapeHtml(next)}</p>
          ${emailCta(reviewUrl, "Open claim &rarr;")}`,
    "Happy Hour Compass &middot; Control Panel notification"
  );

  const bullets = (items: string[]) => items.map((i) => `• ${i}`).join("\n");
  const text = [
    `CLAIM AUTO-APPROVED — ${where}`,
    "",
    `Claimant: ${name} (${ctx.claimant.role})`,
    `Email:    ${ctx.claimant.email}`,
    `Phone:    ${ctx.claimant.phone}`,
    "",
    "Why it auto-approved:",
    bullets(why),
    ...(noted.length ? ["", "Also noted (not enough to require review):", bullets(noted)] : []),
    ...(supporting.length ? ["", "Supporting context:", bullets(supporting)] : []),
    "",
    `Next step: ${next}`,
    "",
    reviewUrl,
  ].join("\n");

  const slack = [
    `:white_check_mark: *CLAIM AUTO-APPROVED* — ${where}`,
    `Claimant: ${name} · ${ctx.claimant.role}`,
    `Email: ${ctx.claimant.email} · Phone: ${ctx.claimant.phone}`,
    "Why it auto-approved:",
    bullets(why),
    ...(noted.length ? ["Also noted (not enough to require review):", bullets(noted)] : []),
    `Next step: ${next}`,
    `<${reviewUrl}|Open claim →>`,
  ].join("\n");

  return { subject, html, text, slack };
}

export async function sendAutoApprovedClaimNotifications(ctx: AutoApprovedClaimContext): Promise<void> {
  const { subject, html, text, slack } = buildAutoApprovedClaimNotification(ctx);
  try {
    const result = await sendTransactionalEmail({
      type: "claim_auto_approved",
      to: getFounderNotificationEmail(),
      subject,
      html,
      text,
      criticality: "important",
    });
    if (!result.ok) console.error("[claimAutoApproval] Founder auto-approved email failed.", { claimId: ctx.claimId });
  } catch (err) {
    console.error("[claimAutoApproval] Founder auto-approved email threw.", err);
  }
  await sendSlackAcquisitionNotification({ channel: "venue-claims", text: slack });
}
