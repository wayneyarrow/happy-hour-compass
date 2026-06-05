/**
 * Plan-limit nudge text helpers.
 *
 * Pure computation — no side effects, no DB access.
 * Usable in server actions, server components, and client components alike.
 *
 * All nudges follow the same shape:
 *   atLimitMsg       — "You've reached the 6-item limit for Pro."
 *   upgradeSuggestion — "Upgrade to Premium to add up to 10 food specials."
 *                        null when the operator is already at the highest plan.
 *
 * Usage pattern in a component:
 *   const { atLimitMsg, upgradeSuggestion } = foodSpecialsNudge(plan);
 */

import {
  PLAN_LABELS,
  maxImages,
  maxFoodSpecials,
  maxDrinkSpecials,
  maxSearchTags,
  maxUsers,
  type OperatorPlan,
} from "@/lib/plans";

// ── Internal ──────────────────────────────────────────────────────────────────

/** Returns the next chargeable upgrade plan for self-serve V1, or null at max. */
function nextPlan(plan: OperatorPlan): "pro" | "premium" | null {
  if (plan === "free") return "pro";
  if (plan === "pro")  return "premium";
  return null;
}

// ── Public types ──────────────────────────────────────────────────────────────

export type LimitNudge = {
  /** "You've reached the 6-item limit for Pro." */
  atLimitMsg: string;
  /** "Upgrade to Premium to add up to 10 food specials." — null at max plan. */
  upgradeSuggestion: string | null;
};

// ── Nudge helpers ─────────────────────────────────────────────────────────────

export function foodSpecialsNudge(plan: OperatorPlan): LimitNudge {
  const limit = maxFoodSpecials(plan);
  const next  = nextPlan(plan);
  return {
    atLimitMsg: next
      ? `You've reached the ${limit}-item limit for ${PLAN_LABELS[plan]}.`
      : `You're using all ${limit} food specials included in ${PLAN_LABELS[plan]}.`,
    upgradeSuggestion: next
      ? `Upgrade to ${PLAN_LABELS[next]} to add up to ${maxFoodSpecials(next)} food specials.`
      : null,
  };
}

export function drinkSpecialsNudge(plan: OperatorPlan): LimitNudge {
  const limit = maxDrinkSpecials(plan);
  const next  = nextPlan(plan);
  return {
    atLimitMsg: next
      ? `You've reached the ${limit}-item limit for ${PLAN_LABELS[plan]}.`
      : `You're using all ${limit} drink specials included in ${PLAN_LABELS[plan]}.`,
    upgradeSuggestion: next
      ? `Upgrade to ${PLAN_LABELS[next]} to add up to ${maxDrinkSpecials(next)} drink specials.`
      : null,
  };
}

export function imagesNudge(plan: OperatorPlan): LimitNudge {
  const limit = maxImages(plan);
  const next  = nextPlan(plan);
  return {
    atLimitMsg: next
      ? `You've reached the ${limit}-photo limit for ${PLAN_LABELS[plan]}.`
      : `You're using all ${limit} photos included in ${PLAN_LABELS[plan]}.`,
    upgradeSuggestion: next
      ? `Upgrade to ${PLAN_LABELS[next]} to upload up to ${maxImages(next)} photos.`
      : null,
  };
}

export function searchTagsNudge(plan: OperatorPlan): LimitNudge {
  const limit = maxSearchTags(plan);
  const next  = nextPlan(plan);
  return {
    atLimitMsg:        `You've used all ${limit} Search Tags included with ${PLAN_LABELS[plan]}.`,
    upgradeSuggestion: next
      ? `Upgrade to ${PLAN_LABELS[next]} to use up to ${maxSearchTags(next)} Search Tags.`
      : null,
  };
}

export function usersNudge(plan: OperatorPlan): LimitNudge {
  const limit   = maxUsers(plan);
  const next    = nextPlan(plan);
  const nextLim = next ? maxUsers(next) : null;
  return {
    atLimitMsg: next
      ? `${PLAN_LABELS[plan]} includes ${limit === 1 ? "1 user" : `${limit} users`}.`
      : `You're using all ${limit} users included in ${PLAN_LABELS[plan]}.`,
    upgradeSuggestion: next && nextLim
      ? `Upgrade to ${PLAN_LABELS[next]} to invite up to ${nextLim} team members.`
      : null,
  };
}
