import Link from "next/link";
import { PLAN_LABELS } from "@/lib/plans";
import { grantLabel, type EffectiveAccess } from "@/lib/planGrants/grantState";
import { lastAccessDateLabel } from "@/lib/planGrants/grantDates";
import type { PausedContentSummary } from "@/lib/planGrants/contentPolicy";
import { formatDate } from "@/lib/controlPanelDateTime";

/**
 * Operator Admin notice for Comp / Trial access (Part 1): the active grant
 * (or a scheduled one), and — for grant recipients whose access has since
 * dropped — what content is preserved but paused publicly. Renders nothing
 * for a venue with no grant activity and nothing paused, so every existing
 * venue's pages look exactly as before.
 *
 * Server component — rendered once by src/app/admin/layout.tsx with
 * ctx.activeVenueAccess and getVenuePausedContent(). The plans link is shown
 * to everyone: members may view the subscription page; only owners can
 * change the plan there.
 */

const PAUSED_LABELS: Array<[keyof Omit<PausedContentSummary, "total">, string, string]> = [
  ["recurringEvents", "recurring event", "recurring events"],
  ["weeklySpecials",  "weekly Daily Special", "weekly Daily Specials"],
  ["foodSpecials",    "food special", "food specials"],
  ["drinkSpecials",   "drink special", "drink specials"],
  ["images",          "photo", "photos"],
  ["searchTags",      "search tag", "search tags"],
];

export default function PlanAccessNotice({
  access,
  paused,
}: {
  access: EffectiveAccess;
  paused: PausedContentSummary;
}) {
  const grant = access.activeGrant;
  const scheduled = access.scheduledGrant;
  if (!grant && !scheduled && paused.total === 0) return null;

  const pausedParts = PAUSED_LABELS
    .filter(([key]) => paused[key] > 0)
    .map(([key, one, many]) => `${paused[key]} ${paused[key] === 1 ? one : many}`);

  return (
    <div className="space-y-3 mb-6">
      {grant && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{grantLabel(grant)}</strong>
          {access.source === "grant" ? (
            <> — complimentary {PLAN_LABELS[grant.planCode]} access from Happy Hour Compass. You&rsquo;re not being billed for it.</>
          ) : (
            <> — your paid plan already includes this access.</>
          )}{" "}
          {grant.endsAt ? <>Access continues through {lastAccessDateLabel(grant.endsAt)}.</> : <>No end date.</>}
        </div>
      )}
      {!grant && scheduled && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <strong>{grantLabel(scheduled)}</strong> starts {formatDate(scheduled.startsAt)}
          {scheduled.endsAt ? <> and continues through {lastAccessDateLabel(scheduled.endsAt)}</> : null}.
        </div>
      )}
      {paused.total > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
          <strong className="text-gray-900">Some content is paused.</strong>{" "}
          {pausedParts.join(", ")} {paused.total === 1 ? "is" : "are"} saved but not shown to guests on your{" "}
          {PLAN_LABELS[access.effectivePlan]} plan. Nothing has been deleted — {paused.total === 1 ? "it returns" : "they return"}{" "}
          automatically if you upgrade. For specials and photos, the first ones in your list stay visible —
          reorder them to choose which. Only your first search tags are used.{" "}
          <Link href="/admin/subscription" className="font-semibold text-amber-700 underline underline-offset-2">
            View plans →
          </Link>
        </div>
      )}
    </div>
  );
}
