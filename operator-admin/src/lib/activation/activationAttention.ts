/**
 * Attention counts for the Claims / Submissions list pages' strip
 * (Release required · Expiring soon · Awaiting setup). Counted from the
 * rows the table is currently showing, so the strip always agrees with the
 * filtered records (market, search and the other filters).
 */

import type { ActivationLifecycleState } from "@/lib/activation/activationState";

export type ActivationAttentionCounts = {
  releaseRequired: number;
  expiringSoon: number;
  awaitingSetup: number;
};

export function countActivationAttention(
  states: Iterable<ActivationLifecycleState>
): ActivationAttentionCounts {
  const counts: ActivationAttentionCounts = { releaseRequired: 0, expiringSoon: 0, awaitingSetup: 0 };
  for (const s of states) {
    if (s === "release_required") counts.releaseRequired++;
    else if (s === "expiring_soon") counts.expiringSoon++;
    else if (s === "awaiting_setup") counts.awaitingSetup++;
  }
  return counts;
}
