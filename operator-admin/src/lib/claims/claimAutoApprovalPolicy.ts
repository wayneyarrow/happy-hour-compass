/**
 * Claim auto-approval — the pure decision engine. No I/O.
 *
 * PHILOSOPHY: auto-approve the normal claim; founder review is the
 * exception for material conflict, abuse, or a meaningful COMBINATION of
 * independent caution signals. This is deliberately NOT a points score:
 * nobody has to "earn" approval, a single weak mismatch never blocks, and
 * ordinary missing/mismatched data (a Gmail address, no phone match, a
 * remote domestic IP, unresolved geo) is neutral.
 *
 *   if any hard condition (H1–H7)               → founder review
 *   else if a strong positive (P1, P2, P3)      → auto-approve
 *   else if C1 and at least one of C2–C6        → founder review (R1)
 *   else if three or more of C2–C6              → founder review (R2)
 *   else                                        → auto-approve
 *
 * A strong positive overcomes caution combinations; it NEVER overrides a
 * hard condition. H7 ("auto-approval unavailable") is routing, not risk —
 * notifications must say so rather than implying the claimant is suspect.
 *
 * Signals are gathered separately (claimAutoApprovalSignals.ts) so this
 * matrix can be tested exhaustively.
 */

export type HardCode =
  | "H1_competing_open_claim"
  | "H2_competing_open_submission"
  | "H3_inconsistent_ownership"
  | "H4_same_email_previously_rejected"
  | "H5_non_operator_account"
  | "H6_claim_velocity"
  | "H7_auto_approval_unavailable";
export type CautionCode =
  | "C1_foreign_ip"
  | "C2_distant_domestic_ip"
  | "C3_role"
  | "C4_non_matching_business_domain"
  | "C5_phone_mismatch"
  | "C6_prior_rejection_other_email";
export type PositiveCode = "P1_business_domain_match" | "P2_phone_match" | "P3_existing_activated_operator";
export type SupportingCode = "P4_local_ip" | "P5_owner_or_manager";

export type Reason<C extends string> = { code: C; explanation: string };

export type ClaimDecisionRule =
  | "hard_condition"
  | "strong_positive"
  | "R1_foreign_ip_plus_caution"
  | "R2_three_cautions"
  | "default_auto_approve";

/** Distances for the IP signals. */
export const DISTANT_DOMESTIC_IP_KM = 500;
export const LOCAL_IP_KM = 50;
/** H6: this claim is the Nth-or-later from the same email/IP in 24h. */
export const CLAIM_VELOCITY_LIMIT = 4;

/** Normalized facts about one claim. Unknown values stay null (neutral). */
export type ClaimSignals = {
  infrastructure: {
    autoApprovalEnabled: boolean;
    emailCodeAvailable: boolean;
    /** An existing unactivated operator holds a live LEGACY lifecycle that would have to be reused. */
    incompatibleLegacyLifecycle: boolean;
    /** A safety-check read failed, so the conflict checks can't be trusted — never auto-approve blind. */
    signalReadFailed: boolean;
  };
  venue: {
    name: string;
    country: string | null;
    /** Meaningful ownership domain (platform/service domains already excluded), or null. */
    websiteDomain: string | null;
    /** Display form of the venue phone, if any. */
    phone: string | null;
    phoneLast10: string | null;
  };
  claimant: {
    email: string;
    emailDomain: string;
    isPublicEmailDomain: boolean;
    phone: string | null;
    phoneLast10: string | null;
    role: string;
  };
  conflicts: {
    competingOpenClaimStatus: string | null;
    competingOpenSubmissionStatus: string | null;
    inconsistentOwnership: boolean;
    priorRejectionSameEmail: boolean;
    priorRejectionOtherEmail: boolean;
    nonOperatorAccountKind: "consumer" | "platform_admin" | "team_member" | null;
  };
  velocity: {
    /** Claims (including this one) from this email in the rolling 24h. */
    emailClaims24h: number;
    /** Claims (including this one) from this IP in the rolling 24h; null when no IP. */
    ipClaims24h: number | null;
  };
  geo: {
    resolved: boolean;
    country: string | null;
    region: string | null;
    city: string | null;
    /** Normalized ISO-2 country codes for comparison. */
    ipCountryCode: string | null;
    venueCountryCode: string | null;
    distanceKm: number | null;
  };
  existingOperator: { exists: boolean; activated: boolean };
};

export type ClaimAutoApprovalDecision = {
  decision: "auto_approved" | "founder_review";
  rule: ClaimDecisionRule;
  hardReasons: Reason<HardCode>[];
  cautions: Reason<CautionCode>[];
  positives: Reason<PositiveCode>[];
  supporting: Reason<SupportingCode>[];
  geoResolved: boolean;
  /** True when the ONLY reason for review is H7 — technical fallback, not claimant risk. */
  technicalFallbackOnly: boolean;
  /** Plain-English lines explaining the decision, most important first. */
  humanReasons: string[];
};

const CAUTION_ROLES = new Set(["Bartender", "Server", "Other"]);
const STRONG_ROLES = new Set(["Owner", "Manager"]);

function place(city: string | null, region: string | null, country: string | null): string {
  return [city, region, country].filter(Boolean).join(", ") || "an unknown location";
}

export function evaluateClaimAutoApproval(s: ClaimSignals): ClaimAutoApprovalDecision {
  const hard: Reason<HardCode>[] = [];
  const cautions: Reason<CautionCode>[] = [];
  const positives: Reason<PositiveCode>[] = [];
  const supporting: Reason<SupportingCode>[] = [];

  // ── Hard conditions ────────────────────────────────────────────────────────
  if (s.conflicts.competingOpenClaimStatus) {
    hard.push({
      code: "H1_competing_open_claim",
      explanation: `Another claim for this venue is still open (status: ${s.conflicts.competingOpenClaimStatus.replace(/_/g, " ")}).`,
    });
  }
  if (s.conflicts.competingOpenSubmissionStatus) {
    hard.push({
      code: "H2_competing_open_submission",
      explanation: `An Add Your Venue submission for this venue is still unresolved (status: ${s.conflicts.competingOpenSubmissionStatus.replace(/_/g, " ")}).`,
    });
  }
  if (s.conflicts.inconsistentOwnership) {
    hard.push({
      code: "H3_inconsistent_ownership",
      explanation: "The venue's ownership records are inconsistent (it isn't marked claimed, but an owner/operator is recorded).",
    });
  }
  if (s.conflicts.priorRejectionSameEmail) {
    hard.push({
      code: "H4_same_email_previously_rejected",
      explanation: `A previous claim for this venue from ${s.claimant.email} was rejected.`,
    });
  }
  if (s.conflicts.nonOperatorAccountKind) {
    const kind = { consumer: "a consumer", platform_admin: "a Control Panel admin", team_member: "a venue team-member" }[
      s.conflicts.nonOperatorAccountKind
    ];
    hard.push({
      code: "H5_non_operator_account",
      explanation: `${s.claimant.email} already has ${kind} Happy Hour Compass account (not an operator account), which automatic setup can't convert.`,
    });
  }
  const emailVelocity = s.velocity.emailClaims24h >= CLAIM_VELOCITY_LIMIT;
  const ipVelocity = s.velocity.ipClaims24h !== null && s.velocity.ipClaims24h >= CLAIM_VELOCITY_LIMIT;
  if (emailVelocity || ipVelocity) {
    const parts = [
      emailVelocity ? `${s.velocity.emailClaims24h} claims from ${s.claimant.email}` : null,
      ipVelocity ? `${s.velocity.ipClaims24h} claims from the same IP address` : null,
    ].filter(Boolean);
    hard.push({ code: "H6_claim_velocity", explanation: `High claim volume in the last 24 hours: ${parts.join(" and ")}.` });
  }
  const infra = s.infrastructure;
  if (!infra.autoApprovalEnabled || !infra.emailCodeAvailable || infra.incompatibleLegacyLifecycle || infra.signalReadFailed) {
    const why = !infra.autoApprovalEnabled
      ? "claim auto-approval is turned off"
      : !infra.emailCodeAvailable
        ? "email-code verification isn't available"
        : infra.signalReadFailed
          ? "some automatic safety checks couldn't be completed"
          : "this operator already has an older (setup-link) activation in progress";
    hard.push({
      code: "H7_auto_approval_unavailable",
      explanation: `Automatic approval was unavailable (${why}). No claimant risk signal triggered this review.`,
    });
  }

  // ── Caution signals ────────────────────────────────────────────────────────
  const g = s.geo;
  if (g.resolved && g.ipCountryCode && g.venueCountryCode && g.ipCountryCode !== g.venueCountryCode) {
    cautions.push({
      code: "C1_foreign_ip",
      explanation: `The claim came from an IP in ${place(g.city, g.region, g.country)}; the venue is in ${s.venue.country ?? g.venueCountryCode}.`,
    });
  } else if (g.resolved && g.distanceKm !== null && g.distanceKm > DISTANT_DOMESTIC_IP_KM) {
    cautions.push({
      code: "C2_distant_domestic_ip",
      explanation: `The claim came from about ${Math.round(g.distanceKm).toLocaleString("en-CA")} km from the venue (${place(g.city, g.region, g.country)}).`,
    });
  }
  if (CAUTION_ROLES.has(s.claimant.role)) {
    cautions.push({ code: "C3_role", explanation: `Role entered: ${s.claimant.role}.` });
  }
  const domainMatch =
    !s.claimant.isPublicEmailDomain &&
    !!s.venue.websiteDomain &&
    (s.claimant.emailDomain === s.venue.websiteDomain || s.claimant.emailDomain.endsWith(`.${s.venue.websiteDomain}`));
  if (!s.claimant.isPublicEmailDomain && s.venue.websiteDomain && !domainMatch) {
    cautions.push({
      code: "C4_non_matching_business_domain",
      explanation: `Claim email domain ${s.claimant.emailDomain} does not match the venue website domain ${s.venue.websiteDomain}.`,
    });
  }
  const phoneMatch = !!s.claimant.phoneLast10 && !!s.venue.phoneLast10 && s.claimant.phoneLast10 === s.venue.phoneLast10;
  if (s.claimant.phoneLast10 && s.venue.phoneLast10 && !phoneMatch) {
    cautions.push({
      code: "C5_phone_mismatch",
      explanation: `Claim phone ${s.claimant.phone} does not match the venue phone ${s.venue.phone}.`,
    });
  }
  if (s.conflicts.priorRejectionOtherEmail) {
    cautions.push({ code: "C6_prior_rejection_other_email", explanation: "The venue has a previously rejected claim from a different email." });
  }

  // ── Positive signals ───────────────────────────────────────────────────────
  if (domainMatch) {
    positives.push({
      code: "P1_business_domain_match",
      explanation: `Business email domain ${s.claimant.emailDomain} matches the venue website (${s.venue.websiteDomain}).`,
    });
  }
  if (phoneMatch) positives.push({ code: "P2_phone_match", explanation: `Claim phone matches the venue phone (${s.venue.phone}).` });
  if (s.existingOperator.exists && s.existingOperator.activated) {
    positives.push({ code: "P3_existing_activated_operator", explanation: `${s.claimant.email} is an existing, activated HHC operator.` });
  }
  if (g.resolved && g.distanceKm !== null && g.distanceKm <= LOCAL_IP_KM && !cautions.some((c) => c.code === "C1_foreign_ip")) {
    supporting.push({ code: "P4_local_ip", explanation: `Claim came from near the venue (~${Math.round(g.distanceKm)} km, ${place(g.city, g.region, null)}).` });
  }
  if (STRONG_ROLES.has(s.claimant.role)) supporting.push({ code: "P5_owner_or_manager", explanation: `Role entered: ${s.claimant.role}.` });

  // ── Decision ───────────────────────────────────────────────────────────────
  const nonForeign = cautions.filter((c) => c.code !== "C1_foreign_ip");
  let decision: ClaimAutoApprovalDecision["decision"];
  let rule: ClaimDecisionRule;
  if (hard.length > 0) {
    decision = "founder_review";
    rule = "hard_condition";
  } else if (positives.length > 0) {
    decision = "auto_approved";
    rule = "strong_positive";
  } else if (cautions.some((c) => c.code === "C1_foreign_ip") && nonForeign.length >= 1) {
    decision = "founder_review";
    rule = "R1_foreign_ip_plus_caution";
  } else if (nonForeign.length >= 3) {
    decision = "founder_review";
    rule = "R2_three_cautions";
  } else {
    decision = "auto_approved";
    rule = "default_auto_approve";
  }

  const technicalFallbackOnly = hard.length > 0 && hard.every((h) => h.code === "H7_auto_approval_unavailable");
  const humanReasons =
    decision === "founder_review"
      ? rule === "hard_condition"
        ? hard.map((h) => h.explanation)
        : cautions.map((c) => c.explanation)
      : positives.length > 0
        ? positives.map((p) => p.explanation)
        : [cautions.length === 0 ? "No conflicts or risk signals were found." : "No conflicts, and no combination of concerns that needs review."];

  return {
    decision,
    rule,
    hardReasons: hard,
    cautions,
    positives,
    supporting,
    geoResolved: g.resolved,
    technicalFallbackOnly,
    humanReasons,
  };
}
