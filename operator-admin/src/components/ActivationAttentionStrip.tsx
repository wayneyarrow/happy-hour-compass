import type { ActivationAttentionCounts } from "@/lib/activation/activationAttention";

/**
 * The Claims / Submissions attention-count strip. Same markup as before it
 * moved out of the server pages; it now receives counts from the filtered
 * rows (see countActivationAttention()).
 */
export default function ActivationAttentionStrip({ counts }: { counts: ActivationAttentionCounts }) {
  const { releaseRequired, expiringSoon, awaitingSetup } = counts;
  if (releaseRequired === 0 && expiringSoon === 0 && awaitingSetup === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
      {releaseRequired > 0 && (
        <span className="text-red-700 font-medium">{releaseRequired} Release required</span>
      )}
      {expiringSoon > 0 && (
        <span className="text-amber-700 font-medium">{expiringSoon} Expiring soon</span>
      )}
      {awaitingSetup > 0 && <span>{awaitingSetup} Awaiting setup</span>}
    </div>
  );
}
