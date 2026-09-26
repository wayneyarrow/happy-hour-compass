import type { ClaimAutoApprovalDecision, ClaimSignals } from "./claimAutoApprovalPolicy";

/**
 * The persisted record of a claim auto-decision — the auto_decision note's
 * text and metadata_json. Pure, so it can be tested without a database.
 *
 * The note text is what Wayne reads in claim / Venue Internal Notes, so it
 * carries the same plain-English context as the founder email: why, what
 * was noted, and the supporting context. Internal codes (H1, C5, P4, …)
 * live ONLY in metadata. Nothing sensitive is stored: no IP address, no IP
 * coordinates, no codes/digests/secrets — geo is city-level place + distance.
 */

type Explained = { explanation: string };

const texts = (items: Explained[]) => items.map((i) => i.explanation);

/** Supporting context worth showing alongside the claimant details (role is already shown there). */
export function supportingWithoutRole(decision: ClaimAutoApprovalDecision): string[] {
  return texts(decision.supporting.filter((s) => s.code !== "P5_owner_or_manager"));
}

export function autoDecisionMetadata(
  decision: ClaimAutoApprovalDecision,
  geo: ClaimSignals["geo"] | null,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    decision: decision.decision,
    rule: decision.rule,
    hardReasons: decision.hardReasons.map((r) => r.code),
    cautions: decision.cautions.map((r) => r.code),
    positives: decision.positives.map((r) => r.code),
    supporting: decision.supporting.map((r) => r.code),
    geoResolved: decision.geoResolved,
    technicalFallbackOnly: decision.technicalFallbackOnly,
    humanReasons: decision.humanReasons,
    explanations: {
      hardReasons: texts(decision.hardReasons),
      cautions: texts(decision.cautions),
      positives: texts(decision.positives),
      supporting: texts(decision.supporting),
    },
    ...(geo?.resolved
      ? {
          geo: {
            country: geo.country,
            region: geo.region,
            city: geo.city,
            distanceKm: geo.distanceKm === null ? null : Math.round(geo.distanceKm),
          },
        }
      : {}),
    ...extra,
  };
}

/** Human-readable auto_decision note for an AUTO-APPROVED claim. */
export function autoApprovedNoteText(
  decision: ClaimAutoApprovalDecision,
  { role, returningOperator }: { role: string; returningOperator: boolean }
): string {
  const parts = ["Claim auto-approved — no founder review needed.", ...decision.humanReasons];
  const noted = texts(decision.cautions);
  if (noted.length) parts.push(`Also noted: ${noted.join(" ")}`);
  const supporting = texts(decision.supporting);
  if (supporting.length) parts.push(`Supporting context: ${supporting.join(" ")}`);
  // Role is normally already covered (P5 Owner/Manager or C3 caution); state it once otherwise.
  const roleCovered = decision.supporting.some((s) => s.code === "P5_owner_or_manager") || decision.cautions.some((c) => c.code === "C3_role");
  if (!roleCovered && role) parts.push(`Role entered: ${role}.`);
  parts.push(
    returningOperator
      ? "Existing activated operator: venue added to their account."
      : "Operator account created; setup continues with email-code verification."
  );
  return parts.join(" ");
}
