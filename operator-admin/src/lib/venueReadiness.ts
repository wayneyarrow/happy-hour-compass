/**
 * Venue readiness engine.
 *
 * Pure module — no DB queries, no Next.js APIs, no side effects.
 * All inputs are derived by callers and passed in. This keeps the engine
 * testable, UI-agnostic, and safe for use in server actions or CS tooling.
 *
 * Three-tier model:
 *   Tier 1 – Required:              block publish if missing
 *   Tier 2 – Strong Recommendations: high-priority but do not block publish
 *   Tier 3 – Recommendations:        nice-to-have, do not block publish
 *
 * Claimed vs submitted venue model:
 *   Claimed venues have imported data that is NOT the same as verified data.
 *   Review tasks (claimedReview_* keys) appear as incomplete until the operator
 *   explicitly confirms each item via the "Mark reviewed" button. This keeps
 *   imported items visible and actionable until human verification occurs.
 *   Missing imported data falls back to standard "Add" tasks.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type ReadinessItem = {
  /** Machine-readable identifier for this signal. */
  key: string;
  /** Short human-readable label (for checklist display). */
  label: string;
  /** One-sentence explanation of why this matters. */
  description: string;
  /** Whether the operator has completed this item. */
  completed: boolean;
};

/** All fields from the venues table needed for readiness computation. */
export type VenueReadinessInput = {
  name?: string | null;
  address_line1?: string | null;
  city?: string | null;
  /** Province or state field — stored as `region` in the DB. */
  region?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  website_url?: string | null;
  menu_url?: string | null;
  establishment_type?: string | null;
  hh_times?: string | null;
  hh_tagline?: string | null;
  /** JSON array string — e.g. '[{"name":"Wings","price":"$5"}]' */
  hh_food_details?: string | null;
  /** JSON array string — e.g. '[{"name":"House Wine","price":"$6"}]' */
  hh_drink_details?: string | null;
  business_hours?: Record<string, unknown> | null;
  /** TEXT column — stored as a JSON array string, e.g. '["Visa","Cash"]' */
  payment_types?: string | null;
  /**
   * Set when a venue claim was approved. Null for operator-created venues.
   * Determines which readiness model applies.
   */
  claimed_at?: string | null;
  /** Total count of venue_image rows in the media table for this venue. */
  imageCount: number;
  /**
   * Count of images uploaded via the operator image upload flow.
   * Detected by URL prefix matching the Supabase venue-images storage bucket.
   */
  operatorImageCount: number;
  /**
   * Map of review task keys that the operator has explicitly confirmed.
   * Populated only for claimed venues via the "Mark reviewed" button.
   * Missing keys or an empty object means unreviewed.
   * Optional — callers that don't need review state (e.g. publish actions)
   * can omit this; review items will simply show as not yet confirmed.
   */
  reviewConfirmations?: Record<string, boolean> | null;
};

/** Boolean signals derived from the venue row. */
export type VenueReadinessSignals = {
  hasVenueName: boolean;
  hasAddressLine1: boolean;
  hasCity: boolean;
  hasProvinceOrState: boolean;
  hasHappyHourTimes: boolean;
  hasAnyVenueImage: boolean;
  hasOperatorVenueImage: boolean;
  isUsingGenericSeededImage: boolean;
  hasConfirmedVenueType: boolean;
  hasFoodSpecials: boolean;
  hasDrinkSpecials: boolean;
  hasBusinessHours: boolean;
  hasMenuLink: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
  hasTagline: boolean;
  hasPaymentTypes: boolean;
  hasPostalCode: boolean;
};

/** Full readiness result returned by computeVenueReadiness(). */
export type VenueReadiness = {
  publishReady: boolean;
  required: ReadinessItem[];
  strongRecommendations: ReadinessItem[];
  recommendations: ReadinessItem[];
  completed: ReadinessItem[];
  signals: VenueReadinessSignals;
  missingRequired: ReadinessItem[];
  missingStrongRecommendations: ReadinessItem[];
  missingRecommendations: ReadinessItem[];
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function hasContent(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSpecialItemCount(raw: string | null | undefined): number {
  if (!raw?.trim()) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string" &&
        ((item as Record<string, unknown>).name as string).trim().length > 0
    ).length;
  } catch {
    return 0;
  }
}

function parsePaymentTypeCount(raw: string | null | undefined): number {
  if (!raw?.trim()) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    return raw.split(",").map((s) => s.trim()).filter(Boolean).length;
  }
  return 0;
}

// ── Public: image classification helper ──────────────────────────────────────

/**
 * Counts how many media rows were uploaded via the operator image upload flow.
 * Operator images live in the `venue-images` Supabase Storage bucket at
 * path `venues/{venueId}/{uuid}.jpg`. Seeded images typically have external URLs.
 */
export function computeOperatorImageCount(
  images: Array<{ url: string }>,
  supabaseUrl: string
): number {
  if (!supabaseUrl) return images.length;
  const prefix = `${supabaseUrl}/storage/v1/object/public/venue-images/venues/`;
  return images.filter((img) => img.url.startsWith(prefix)).length;
}

// ── Public: core readiness computation ───────────────────────────────────────

export function computeVenueReadiness(input: VenueReadinessInput): VenueReadiness {
  const isClaimed = !!input.claimed_at;
  // Shorthand: rc["key"] === true means explicitly confirmed by the operator.
  const rc = input.reviewConfirmations ?? {};

  // ── Derive signals ──────────────────────────────────────────────────────────

  const hasVenueName        = hasContent(input.name);
  const hasAddressLine1     = hasContent(input.address_line1);
  const hasCity             = hasContent(input.city);
  const hasProvinceOrState  = hasContent(input.region);
  const hasHappyHourTimes   = hasContent(input.hh_times);
  const hasAnyVenueImage    = input.imageCount > 0;
  const hasOperatorVenueImage = input.operatorImageCount > 0;
  const isUsingGenericSeededImage = hasAnyVenueImage && !hasOperatorVenueImage;
  const hasConfirmedVenueType = hasContent(input.establishment_type);
  const hasFoodSpecials     = parseSpecialItemCount(input.hh_food_details) > 0;
  const hasDrinkSpecials    = parseSpecialItemCount(input.hh_drink_details) > 0;
  const hasBusinessHours    =
    input.business_hours !== null &&
    input.business_hours !== undefined &&
    Object.keys(input.business_hours).length > 0;
  const hasMenuLink         = hasContent(input.menu_url);
  const hasPhone            = hasContent(input.phone);
  const hasWebsite          = hasContent(input.website_url);
  const hasTagline          = hasContent(input.hh_tagline);
  const hasPaymentTypes     = parsePaymentTypeCount(input.payment_types) > 0;
  const hasPostalCode       = hasContent(input.postal_code);

  const signals: VenueReadinessSignals = {
    hasVenueName, hasAddressLine1, hasCity, hasProvinceOrState, hasHappyHourTimes,
    hasAnyVenueImage, hasOperatorVenueImage, isUsingGenericSeededImage,
    hasConfirmedVenueType, hasFoodSpecials, hasDrinkSpecials, hasBusinessHours,
    hasMenuLink, hasPhone, hasWebsite, hasTagline, hasPaymentTypes, hasPostalCode,
  };

  // ── Tier 1: Required — blocks publish if missing ───────────────────────────
  //
  // Image rule: claimed venues with any image (including seeded) satisfy publish.
  // When a placeholder is present, the required item is omitted — the review
  // task handles the "upload your own" nudge. When a claimed venue has NO image,
  // the standard required item is shown.

  const imageCompleted = isClaimed ? hasAnyVenueImage : hasOperatorVenueImage;

  const required: ReadinessItem[] = [
    {
      key: "hasVenueName",
      label: "Venue name",
      description: "The name guests will see on your public listing.",
      completed: hasVenueName,
    },
    {
      key: "hasAddressLine1",
      label: "Street address",
      description: "Guests need an address to find your venue.",
      completed: hasAddressLine1,
    },
    {
      key: "hasCity",
      label: "City",
      description: "Required for location search and market filtering.",
      completed: hasCity,
    },
    {
      key: "hasProvinceOrState",
      label: "Province / State",
      description: "Required for location search and market filtering.",
      completed: hasProvinceOrState,
    },
    {
      key: "hasHappyHourTimes",
      label: "Happy hour times",
      description: "Guests come specifically to find happy hour deals — times are essential.",
      completed: hasHappyHourTimes,
    },
    // For claimed venues with any image: omit (placeholder satisfies publish).
    // For claimed venues with no image: include (nothing imported, must upload).
    // For submitted venues: always include (requires operator-uploaded image).
    ...(!isClaimed || !hasAnyVenueImage
      ? [
          {
            key: "hasVenueImage",
            label: isClaimed ? "Add a venue image" : "Upload a venue image",
            description: isClaimed
              ? "A venue photo helps guests recognise and trust your listing."
              : "Upload at least one photo of your venue. Guests are more likely to visit venues with real photos.",
            completed: imageCompleted,
          },
        ]
      : []),
  ];

  // ── Tier 2: Strong Recommendations ─────────────────────────────────────────
  //
  // Claimed venues: imported data ≠ verified data.
  //   Items with imported values appear as review tasks (completed = explicitly
  //   reviewed via the "Mark reviewed" button). Items with missing values fall
  //   back to standard "Add" tasks so operators know to fill them in.
  //
  // Submitted venues: standard profile-completion items. No review tasks.

  const strongRecommendations: ReadinessItem[] = [
    ...(isClaimed
      ? [
          // ── Claimed: review items (only when imported data exists) ────────

          // Business details: review when address was imported.
          // If any address field is missing it shows as required above.
          ...(hasAddressLine1 && hasCity && hasProvinceOrState
            ? [
                {
                  key: "claimedReview_businessDetails",
                  label: "Review your business details",
                  description:
                    "Check that the imported address and contact details are correct for your venue.",
                  completed: rc["claimedReview_businessDetails"] === true,
                },
              ]
            : []),

          // Venue type: review if imported, add task if missing.
          ...(hasConfirmedVenueType
            ? [
                {
                  key: "claimedReview_venueType",
                  label: "Confirm your venue type",
                  description:
                    "The imported venue type may not match your establishment. Set it correctly so guests can find you in the right searches.",
                  completed: rc["claimedReview_venueType"] === true,
                },
              ]
            : [
                {
                  key: "hasConfirmedVenueType",
                  label: "Confirm venue type",
                  description:
                    "Helps guests find venues that match their preferences. Set your establishment type in Business Details.",
                  completed: false,
                },
              ]),

          // Business hours: review if imported, add task if missing.
          ...(hasBusinessHours
            ? [
                {
                  key: "claimedReview_businessHours",
                  label: "Review your business hours",
                  description:
                    "Guests check hours before visiting. Make sure the imported schedule is accurate and up to date.",
                  completed: rc["claimedReview_businessHours"] === true,
                },
              ]
            : [
                {
                  key: "hasBusinessHours",
                  label: "Add business hours",
                  description:
                    "Guests check hours before visiting. Complete hours reduce no-shows.",
                  completed: false,
                },
              ]),

          // HH times: review when imported. If missing, the required item above
          // handles it as a blocking task — no duplicate entry needed here.
          ...(hasHappyHourTimes
            ? [
                {
                  key: "claimedReview_hhTimes",
                  label: "Review your happy hour times",
                  description:
                    "The happy hour schedule shown to guests came from imported data. Verify the days and times are accurate.",
                  completed: rc["claimedReview_hhTimes"] === true,
                },
              ]
            : []),

          // HH specials: review if any exist, otherwise standard add tasks.
          ...(hasFoodSpecials || hasDrinkSpecials
            ? [
                {
                  key: "claimedReview_hhSpecials",
                  label: "Review your happy hour specials",
                  description:
                    "Food and drink deals are the #1 reason guests choose a venue. Review any imported items or add your own.",
                  completed: rc["claimedReview_hhSpecials"] === true,
                },
              ]
            : [
                ...(!hasFoodSpecials
                  ? [
                      {
                        key: "hasFoodSpecials",
                        label: "Add food specials",
                        description:
                          "Food specials are among the most searched happy hour features.",
                        completed: false,
                      },
                    ]
                  : []),
                ...(!hasDrinkSpecials
                  ? [
                      {
                        key: "hasDrinkSpecials",
                        label: "Add drink specials",
                        description:
                          "Drink deals are the #1 reason guests choose a happy hour venue.",
                        completed: false,
                      },
                    ]
                  : []),
              ]),

          // Placeholder image: show when the listing has only seeded images.
          // Completed by uploading (not a review button — the upload IS the action).
          ...(isUsingGenericSeededImage
            ? [
                {
                  key: "claimedReview_image",
                  label: "Upload your own venue photo",
                  description:
                    "Your listing shows a placeholder photo. Upload a real image of your venue to build guest trust and make a stronger impression.",
                  completed: hasOperatorVenueImage,
                },
              ]
            : []),

          // Menu link: review if imported, add task if missing.
          ...(hasMenuLink
            ? [
                {
                  key: "claimedReview_menuLink",
                  label: "Review your menu link",
                  description:
                    "Check that the imported menu link is current and working. Guests use it to browse your offerings before visiting.",
                  completed: rc["claimedReview_menuLink"] === true,
                },
              ]
            : [
                {
                  key: "hasMenuLink",
                  label: "Add menu link",
                  description: "A menu link drives more confident, informed guest visits.",
                  completed: false,
                },
              ]),

          // Website: review if imported. If missing, stays in recommendations below.
          ...(hasWebsite
            ? [
                {
                  key: "claimedReview_website",
                  label: "Review your website",
                  description:
                    "Confirm that the imported website URL is accurate and up to date.",
                  completed: rc["claimedReview_website"] === true,
                },
              ]
            : []),

          // Phone: review if imported. If missing, stays in recommendations below.
          ...(hasPhone
            ? [
                {
                  key: "claimedReview_phone",
                  label: "Review your phone number",
                  description:
                    "Guests may call ahead to check on specials or ask questions. Verify the imported number is correct.",
                  completed: rc["claimedReview_phone"] === true,
                },
              ]
            : []),
        ]
      : [
          // ── Submitted venues: standard profile-completion items ────────────

          {
            key: "hasConfirmedVenueType",
            label: "Confirm venue type",
            description:
              "Helps guests find venues that match their preferences. Set your establishment type in Business Details.",
            completed: hasConfirmedVenueType,
          },
          {
            key: "hasFoodSpecials",
            label: "Add food specials",
            description: "Food specials are among the most searched happy hour features.",
            completed: hasFoodSpecials,
          },
          {
            key: "hasDrinkSpecials",
            label: "Add drink specials",
            description: "Drink deals are the #1 reason guests choose a happy hour venue.",
            completed: hasDrinkSpecials,
          },
          {
            key: "hasBusinessHours",
            label: "Add business hours",
            description: "Guests check hours before visiting. Complete hours reduce no-shows.",
            completed: hasBusinessHours,
          },
        ]),

    // Menu link for submitted venues. Claimed venues handle it in the block above.
    ...(!isClaimed
      ? [
          {
            key: "hasMenuLink",
            label: "Add menu link",
            description: "A menu link drives more confident, informed guest visits.",
            completed: hasMenuLink,
          },
        ]
      : []),
  ];

  // ── Tier 3: Recommendations — nice-to-have, do not block publish ───────────
  //
  // For claimed venues: phone and website are excluded when they have imported
  // values (those appear as claimedReview_* tasks in Tier 2 above). They remain
  // here only when the value is missing — as standard "Add" tasks.

  const recommendations: ReadinessItem[] = [
    // Phone: always for submitted; for claimed only when not imported.
    ...(!isClaimed || !hasPhone
      ? [
          {
            key: "hasPhone",
            label: "Add a phone number",
            description:
              "Lets guests call ahead to check on specials, make a reservation, or ask questions.",
            completed: hasPhone,
          },
        ]
      : []),
    // Website: always for submitted; for claimed only when not imported.
    ...(!isClaimed || !hasWebsite
      ? [
          {
            key: "hasWebsite",
            label: "Link your website",
            description:
              "Connects your listing to your main online presence so guests can learn more.",
            completed: hasWebsite,
          },
        ]
      : []),
    {
      key: "hasTagline",
      label: "Add a short tagline",
      description: "A quick line about what makes your happy hour worth visiting.",
      completed: hasTagline,
    },
    {
      key: "hasPaymentTypes",
      label: "Show accepted payment methods",
      description: "Guests appreciate knowing what payment you accept before they arrive.",
      completed: hasPaymentTypes,
    },
    {
      key: "hasPostalCode",
      label: "Add postal code",
      description: "Improves location accuracy for map and search results.",
      completed: hasPostalCode,
    },
  ];

  // ── Derived lists ───────────────────────────────────────────────────────────

  const missingRequired              = required.filter((i) => !i.completed);
  const missingStrongRecommendations = strongRecommendations.filter((i) => !i.completed);
  const missingRecommendations       = recommendations.filter((i) => !i.completed);

  const completed = [
    ...required,
    ...strongRecommendations,
    ...recommendations,
  ].filter((i) => i.completed);

  const publishReady = missingRequired.length === 0;

  return {
    publishReady,
    required,
    strongRecommendations,
    recommendations,
    completed,
    signals,
    missingRequired,
    missingStrongRecommendations,
    missingRecommendations,
  };
}
