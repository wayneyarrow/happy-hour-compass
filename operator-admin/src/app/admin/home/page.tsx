// Always fetch fresh data so the checklist reflects the latest profile state.
export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import {
  computeVenueReadiness,
  computeOperatorImageCount,
  type ReadinessItem,
} from "@/lib/venueReadiness";
import { markReviewedAction } from "./actions";

// ── Deep-link destinations for each readiness signal key ─────────────────────

const ITEM_HREF: Record<string, string> = {
  // Claimed-venue review tasks
  claimedReview_businessDetails: "/admin/venue?section=business-details#business-details",
  claimedReview_venueType:       "/admin/venue?section=business-details#business-details",
  claimedReview_businessHours:   "/admin/venue?section=business-hours#business-hours",
  claimedReview_hhTimes:         "/admin/happy-hours?section=times#times",
  claimedReview_hhSpecials:      "/admin/happy-hours?section=food#food",
  claimedReview_image:           "/admin/venue?section=images#images",
  claimedReview_menuLink:        "/admin/venue?section=links#links",
  claimedReview_website:         "/admin/venue?section=links#links",
  claimedReview_phone:           "/admin/venue?section=business-details#business-details",
  // Standard items
  hasVenueName:         "/admin/venue?section=business-details#business-details",
  hasAddressLine1:      "/admin/venue?section=business-details#business-details",
  hasCity:              "/admin/venue?section=business-details#business-details",
  hasProvinceOrState:   "/admin/venue?section=business-details#business-details",
  hasHappyHourTimes:    "/admin/happy-hours?section=times#times",
  hasVenueImage:        "/admin/venue?section=images#images",
  hasConfirmedVenueType:"/admin/venue?section=business-details#business-details",
  hasFoodSpecials:      "/admin/happy-hours?section=food#food",
  hasDrinkSpecials:     "/admin/happy-hours?section=drink#drink",
  hasBusinessHours:     "/admin/venue?section=business-hours#business-hours",
  hasMenuLink:          "/admin/venue?section=links#links",
  hasPhone:             "/admin/venue?section=business-details#business-details",
  hasWebsite:           "/admin/venue?section=links#links",
  hasTagline:           "/admin/happy-hours?section=tagline#tagline",
  hasPaymentTypes:      "/admin/venue?section=payment-types#payment-types",
  hasPostalCode:        "/admin/venue?section=business-details#business-details",
};

// Action link labels for incomplete items.
const ITEM_ACTION: Record<string, string> = {
  // Claimed-venue review tasks
  claimedReview_businessDetails: "Review details",
  claimedReview_venueType:       "Confirm type",
  claimedReview_businessHours:   "Review hours",
  claimedReview_hhTimes:         "Review times",
  claimedReview_hhSpecials:      "Review specials",
  claimedReview_image:           "Upload photo",
  claimedReview_menuLink:        "Review link",
  claimedReview_website:         "Review site",
  claimedReview_phone:           "Review phone",
  // Standard items
  hasVenueName:         "Edit details",
  hasAddressLine1:      "Add address",
  hasCity:              "Add city",
  hasProvinceOrState:   "Add province",
  hasHappyHourTimes:    "Set times",
  hasVenueImage:        "Upload photo",
  hasConfirmedVenueType:"Set type",
  hasFoodSpecials:      "Add specials",
  hasDrinkSpecials:     "Add specials",
  hasBusinessHours:     "Add hours",
  hasMenuLink:          "Add link",
  hasPhone:             "Add phone",
  hasWebsite:           "Add website",
  hasTagline:           "Add tagline",
  hasPaymentTypes:      "Add payments",
  hasPostalCode:        "Add postal",
};

// ── Venue row type ─────────────────────────────────────────────────────────────

type HomeVenueRow = {
  id: string;
  slug: string | null;
  name: string | null;
  is_published: boolean | null;
  claimed_at: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  phone: string | null;
  website_url: string | null;
  menu_url: string | null;
  establishment_type: string | null;
  hh_times: string | null;
  hh_tagline: string | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
  business_hours: Record<string, unknown> | null;
  payment_types: string | null;
  review_confirmations: Record<string, boolean> | null;
};

const VENUE_SELECT =
  "id, slug, name, is_published, claimed_at, address_line1, city, region, postal_code, " +
  "phone, website_url, menu_url, establishment_type, hh_times, hh_tagline, " +
  "hh_food_details, hh_drink_details, business_hours, payment_types, review_confirmations";

// ── Keys for claimed-venue imported-data review tasks ─────────────────────────
// Used to split strongRecommendations into review tasks vs standard improvements.

const CLAIMED_REVIEW_KEYS = new Set([
  "claimedReview_businessDetails",
  "claimedReview_venueType",
  "claimedReview_businessHours",
  "claimedReview_hhTimes",
  "claimedReview_hhSpecials",
  "claimedReview_image",
  "claimedReview_menuLink",
  "claimedReview_website",
  "claimedReview_phone",
]);

// ── Presentational components ──────────────────────────────────────────────────

// Expandable completed-items summary.
// Collapsed by default: shows "✓ N items already complete" + "Show completed" toggle.
// Expanded: reveals individual rows with action links (Review/View/Add).
function ExpandableCompletedSummary({ completedItems }: { completedItems: ReadinessItem[] }) {
  const count = completedItems.length;
  if (count === 0) return null;
  return (
    <details className="group">
      <summary className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-100 bg-white cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <svg className="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span className="text-xs text-gray-400 flex-1">
          {count === 1 ? "1 item already complete" : `${count} items already complete`}
        </span>
        <span className="text-xs text-gray-400 group-open:hidden">Show completed</span>
        <span className="text-xs text-gray-400 hidden group-open:inline">Hide</span>
      </summary>
      <div className="mt-1.5 space-y-1">
        {completedItems.map((item) => {
          const href = ITEM_HREF[item.key] ?? "/admin/venue";
          const action = ITEM_ACTION[item.key] ?? "View";
          return (
            <div key={item.key} className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-gray-100">
              <svg className="w-4 h-4 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="flex-1 text-sm text-gray-500">{item.label}</span>
              <Link href={href} className="shrink-0 text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap">
                {action} →
              </Link>
            </div>
          );
        })}
      </div>
    </details>
  );
}

// ReviewItemRow — renders an unreviewed claimed-venue imported item.
// Shows two actions: a deep-link "Review →" and a "✓ Mark reviewed" form button.
// The image task is special: its confirmation is uploading, not clicking a button.
function ReviewItemRow({ item }: { item: ReadinessItem }) {
  const href = ITEM_HREF[item.key] ?? "/admin/venue";
  const action = ITEM_ACTION[item.key] ?? "Review";
  const isImageTask = item.key === "claimedReview_image";

  return (
    <div className="flex items-start gap-3 px-4 py-4 bg-amber-50/40 rounded-xl border border-amber-200">
      <div className="w-5 h-5 rounded-full border-2 border-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 leading-5">{item.label}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.description}</p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5 mt-0.5">
        <Link href={href} className="text-xs font-semibold text-amber-700 hover:text-amber-800 whitespace-nowrap">
          {action} →
        </Link>
        {!isImageTask && (
          <form action={markReviewedAction}>
            <input type="hidden" name="itemKey" value={item.key} />
            <button
              type="submit"
              className="text-xs text-gray-400 hover:text-green-700 font-medium whitespace-nowrap transition-colors"
            >
              ✓ Mark reviewed
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

type Tier = "required" | "strong" | "recommendation";

// Renders a single incomplete non-review readiness item.
function ReadinessRow({ item, tier }: { item: ReadinessItem; tier: Tier }) {
  const href   = ITEM_HREF[item.key]   ?? "/admin/venue";
  const action = ITEM_ACTION[item.key] ?? "Go to";

  if (tier === "required") {
    return (
      <div className="flex items-start gap-3 px-4 py-4 bg-white rounded-xl border border-amber-200">
        <div className="w-5 h-5 rounded-full border-2 border-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-5">{item.label}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.description}</p>
        </div>
        <Link
          href={href}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-700 transition-colors"
        >
          {action}
        </Link>
      </div>
    );
  }

  if (tier === "strong") {
    return (
      <div className="flex items-start gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200">
        <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 leading-5">{item.label}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.description}</p>
        </div>
        <Link
          href={href}
          className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-800 mt-0.5 whitespace-nowrap"
        >
          {action} →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 px-4 py-3.5 bg-white rounded-xl border border-gray-100">
      <div className="w-5 h-5 rounded-full border-2 border-gray-200 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 leading-5">{item.label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
      </div>
      <Link
        href={href}
        className="shrink-0 text-xs text-gray-400 hover:text-gray-600 mt-0.5 whitespace-nowrap"
      >
        {action} →
      </Link>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await resolveOperatorContext();
  const { operator, operatorError, isImpersonating, impersonatingVenueId } = ctx;

  let venue: HomeVenueRow | null = null;
  let venueError: { message: string } | null = null;

  if (operator) {
    const { data, error } = await ctx.supabase
      .from("venues")
      .select(VENUE_SELECT)
      .eq("created_by_operator_id", operator.id)
      .maybeSingle();
    venue = data as HomeVenueRow | null;
    venueError = error as { message: string } | null;
  } else if (isImpersonating && impersonatingVenueId) {
    const { data, error } = await ctx.supabase
      .from("venues")
      .select(VENUE_SELECT)
      .eq("id", impersonatingVenueId)
      .maybeSingle();
    venue = data as HomeVenueRow | null;
    venueError = error as { message: string } | null;
  }

  let imageCount = 0;
  let operatorImageCount = 0;

  if (venue?.id) {
    const { data: imageData } = await ctx.supabase
      .from("media")
      .select("id, url")
      .eq("venue_id", venue.id)
      .eq("type", "venue_image");

    const allImages = (imageData ?? []) as { id: string; url: string }[];
    imageCount = allImages.length;
    operatorImageCount = computeOperatorImageCount(
      allImages,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
    );
  }

  const readiness = venue
    ? computeVenueReadiness({
        ...venue,
        imageCount,
        operatorImageCount,
        reviewConfirmations: venue.review_confirmations ?? {},
      })
    : null;

  const isPublished = !!venue?.is_published;
  const isClaimed   = !!venue?.claimed_at;
  const venueName   = venue?.name ?? "Your venue";

  // Status card context message.
  // Claimed venues: reinforce "we imported your data — please review" framing.
  // Submitted venues: reinforce "complete and publish" framing.
  let contextMessage: string;
  if (!venue) {
    contextMessage = "Create your venue profile to get started on Happy Hour Compass.";
  } else if (isPublished) {
    contextMessage = isClaimed
      ? "Your venue is live. It was created from imported data — review the important items below to make sure guests see accurate information."
      : "Your venue is live on Happy Hour Compass.";
  } else if (readiness?.publishReady) {
    contextMessage = isClaimed
      ? "Your imported profile is ready to publish — finish reviewing your details, then publish from Venue settings."
      : "Your profile is ready to go live. Publish from Venue settings.";
  } else if (isClaimed) {
    contextMessage =
      "We created your listing using imported venue data. Review the details below to make sure everything shown to guests is accurate before you go live.";
  } else {
    contextMessage = "Complete the required items below before publishing.";
  }

  const everythingDone =
    !!readiness &&
    readiness.missingRequired.length === 0 &&
    readiness.missingStrongRecommendations.length === 0 &&
    readiness.missingRecommendations.length === 0;

  // ── Section data pre-computations ─────────────────────────────────────────

  const incompleteRequired = readiness ? readiness.required.filter((i) => !i.completed) : [];
  const completedRequired  = readiness ? readiness.required.filter((i) => i.completed) : [];

  // Split strong recommendations into claimed review tasks vs standard improvements.
  const reviewItems      = readiness
    ? readiness.strongRecommendations.filter((i) => CLAIMED_REVIEW_KEYS.has(i.key))
    : [];
  const improvementItems = readiness
    ? readiness.strongRecommendations.filter((i) => !CLAIMED_REVIEW_KEYS.has(i.key))
    : [];

  const incompleteReviewItems = reviewItems.filter((i) => !i.completed);
  const completedReviewItems  = reviewItems.filter((i) => i.completed);

  const incompleteImprovements = improvementItems.filter((i) => !i.completed);
  const completedImprovements  = improvementItems.filter((i) => i.completed);

  const incompleteRecs = readiness ? readiness.recommendations.filter((i) => !i.completed) : [];
  const completedRecs  = readiness ? readiness.recommendations.filter((i) => i.completed) : [];

  return (
    <div className="max-w-2xl">

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Venue Growth & Readiness</h2>
        <p className="text-sm text-gray-500 mt-1">Your venue profile action center.</p>
      </div>

      {/* ── Error states ──────────────────────────────────────────────────── */}
      {operatorError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-4">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}
      {venueError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-4">
          <strong>Error loading venue:</strong> {venueError.message}
        </div>
      )}

      <div className="space-y-5">

        {/* ── No venue yet ────────────────────────────────────────────────── */}
        {!venue && !venueError && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-1">Set up your venue</h3>
            <p className="text-sm text-gray-500 mb-4">{contextMessage}</p>
            <Link
              href="/admin/venue"
              className="inline-flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              Create your venue
            </Link>
          </div>
        )}

        {/* ── Venue status card ──────────────────────────────────────────── */}
        {venue && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap mb-1">
                  <span className="text-base font-semibold text-gray-900 truncate">{venueName}</span>
                  {isPublished ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      Live
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                      Unpublished
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{contextMessage}</p>
              </div>
              <Link
                href="/admin/venue"
                className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-800 whitespace-nowrap"
              >
                Edit venue →
              </Link>
            </div>

            {/* Publish CTA */}
            {!isPublished && readiness?.publishReady && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3 flex-wrap">
                <Link
                  href="/admin/venue"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors"
                >
                  Publish your venue →
                </Link>
                <span className="text-xs text-gray-400">
                  Scroll to the Publish section on the Venue page.
                </span>
              </div>
            )}

            {/* Preview link */}
            {isPublished && venue.id && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <a
                  href={`/venue/${venue.slug ?? venue.id}?preview=true`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Preview public listing
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── Required items ──────────────────────────────────────────────── */}
        {venue && readiness && (
          <section aria-label="Required items">
            <div className="flex items-start justify-between gap-3 mb-2 px-0.5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {/* Claimed venues: always "Required to publish" —
                      "Important profile items" is reserved for review tasks.
                      Submitted venues: "Important profile items" once live. */}
                  {isClaimed
                    ? "Required to publish"
                    : isPublished
                      ? "Important profile items"
                      : "Required to publish"}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {incompleteRequired.length === 0
                    ? isPublished
                      ? "All core profile items are filled in."
                      : "All required items are complete."
                    : isPublished
                      ? `${incompleteRequired.length} item${incompleteRequired.length === 1 ? "" : "s"} still incomplete.`
                      : `${incompleteRequired.length} of ${readiness.required.length} items still needed.`}
                </p>
              </div>
              {incompleteRequired.length === 0 && (
                <span className="shrink-0 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                  ✓ Complete
                </span>
              )}
            </div>
            {incompleteRequired.length > 0 && (
              <div className="space-y-2">
                {incompleteRequired.map((item) => (
                  <ReadinessRow key={item.key} item={item} tier="required" />
                ))}
                <ExpandableCompletedSummary completedItems={completedRequired} />
              </div>
            )}
          </section>
        )}

        {/* ── Claimed-venue: Important profile items (review tasks) ────────── */}
        {/* Shown for all claimed venues regardless of review progress.
            Incomplete items show with amber border + "Mark reviewed" button.
            Completed (reviewed) items move into the expandable summary. */}
        {venue && readiness && isClaimed && reviewItems.length > 0 && (
          <section aria-label="Important profile items">
            <div className="mb-2 px-0.5">
              <h3 className="text-sm font-semibold text-gray-900">Important profile items</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Your listing was created from imported data. Verify these customer-facing
                details — click &ldquo;Mark reviewed&rdquo; once you&apos;ve confirmed each item is accurate.
              </p>
            </div>
            <div className="space-y-2">
              {incompleteReviewItems.map((item) => (
                <ReviewItemRow key={item.key} item={item} />
              ))}
              <ExpandableCompletedSummary completedItems={completedReviewItems} />
            </div>
          </section>
        )}

        {/* ── Improvement suggestions ──────────────────────────────────────── */}
        {venue && readiness && incompleteImprovements.length > 0 && (
          <section aria-label={isPublished ? "Improve your listing" : "Finish your listing"}>
            <div className="mb-2 px-0.5">
              <h3 className="text-sm font-semibold text-gray-900">
                {isPublished ? "Improve your listing" : "Finish your listing"}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {isPublished
                  ? "These additions make your venue more discoverable and help it stand out to guests."
                  : "Complete these items to prepare your listing for publish."}
              </p>
            </div>
            <div className="space-y-2">
              {incompleteImprovements.map((item) => (
                <ReadinessRow key={item.key} item={item} tier="strong" />
              ))}
              <ExpandableCompletedSummary completedItems={completedImprovements} />
            </div>
          </section>
        )}

        {/* ── Profile suggestions ──────────────────────────────────────────── */}
        {venue && readiness && incompleteRecs.length > 0 && (
          <section aria-label="Optional optimizations">
            <div className="mb-2 px-0.5">
              <h3 className="text-sm font-semibold text-gray-700">Keep optimizing</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Optional details that round out your profile.
              </p>
            </div>
            <div className="space-y-2">
              {incompleteRecs.map((item) => (
                <ReadinessRow key={item.key} item={item} tier="recommendation" />
              ))}
              <ExpandableCompletedSummary completedItems={completedRecs} />
            </div>
          </section>
        )}

        {/* ── Everything complete ─────────────────────────────────────────── */}
        {everythingDone && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4">
            <p className="text-sm font-semibold text-green-800">
              Your venue profile is in great shape.
            </p>
            <p className="text-xs text-green-700 mt-0.5">
              {isPublished
                ? "You're ready to attract more customers. Check back as new tools become available."
                : "You're ready to go live. Head to Venue settings to publish your profile."}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
