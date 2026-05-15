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
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type ReadinessItem = {
  /** Machine-readable identifier for this signal. */
  key: string;
  /** Short human-readable label (for checklist display). */
  label: string;
  /** One-sentence explanation of why this matters (for future UI). */
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
   * Set when a venue claim was approved. Null for operator-created (non-claimed)
   * venues. Used to determine which image rule applies:
   *   - Non-claimed: must have at least one operator-uploaded image.
   *   - Claimed: any image (including seeded) satisfies publish; operator image
   *              is a strong recommendation to replace the seeded one.
   */
  claimed_at?: string | null;
  /** Total count of venue_image rows in the media table for this venue. */
  imageCount: number;
  /**
   * Count of images uploaded via the operator image upload flow.
   * Detected by URL prefix matching the Supabase venue-images storage bucket.
   * See computeOperatorImageCount() below for derivation.
   *
   * For non-claimed (operator-created) venues, seeded images are never injected,
   * so operatorImageCount === imageCount in practice.
   */
  operatorImageCount: number;
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
  /**
   * True when media rows exist but none match the operator storage URL pattern.
   * Indicates the listing is showing a seeded/imported image rather than an
   * operator-branded photo.
   */
  isUsingGenericSeededImage: boolean;
  /**
   * True when establishment_type has been explicitly saved (non-null, non-empty).
   * A freshly created venue has null here until the operator saves Business Details.
   */
  hasConfirmedVenueType: boolean;
  hasFoodSpecials: boolean;
  hasDrinkSpecials: boolean;
  /** True when business_hours JSONB object has at least one day key configured. */
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
  /** True when all Tier 1 (required) items are complete. */
  publishReady: boolean;
  /** All items in the Required tier (completed and incomplete). */
  required: ReadinessItem[];
  /** All items in the Strong Recommendation tier (completed and incomplete). */
  strongRecommendations: ReadinessItem[];
  /** All items in the Recommendation tier (completed and incomplete). */
  recommendations: ReadinessItem[];
  /** All completed items across all tiers — useful for progress display. */
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
    // Fallback: legacy comma-separated format
    return raw.split(",").map((s) => s.trim()).filter(Boolean).length;
  }
  return 0;
}

// ── Public: image classification helper ──────────────────────────────────────

/**
 * Counts how many media rows were uploaded via the operator image upload flow.
 *
 * Operator images are stored in the `venue-images` Supabase Storage bucket at
 * path `venues/{venueId}/{uuid}.jpg`. Their public URLs therefore begin with:
 *   {NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/venue-images/venues/
 *
 * Seeded or bulk-imported images typically have external URLs or a different
 * bucket/path. If the Supabase URL is unavailable, all images are conservatively
 * treated as operator images to avoid false publish blocks.
 *
 * Limitation: if the bulk-import pipeline stores images in the same bucket and
 * path prefix, this heuristic will misclassify those as operator images. A
 * `source` column on the media table (e.g. "operator" | "seeded") would make
 * this detection reliable and is the recommended future improvement.
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
    hasVenueName,
    hasAddressLine1,
    hasCity,
    hasProvinceOrState,
    hasHappyHourTimes,
    hasAnyVenueImage,
    hasOperatorVenueImage,
    isUsingGenericSeededImage,
    hasConfirmedVenueType,
    hasFoodSpecials,
    hasDrinkSpecials,
    hasBusinessHours,
    hasMenuLink,
    hasPhone,
    hasWebsite,
    hasTagline,
    hasPaymentTypes,
    hasPostalCode,
  };

  // ── Tier 1: Required — blocks publish if missing ───────────────────────────
  //
  // Image rule differs by venue origin:
  //   Submitted (operator-created): requires at least one operator-uploaded image.
  //   Claimed: any image (including a placeholder) satisfies the publish requirement.
  //            When the publish requirement is already met, the required item is
  //            omitted so operators don't see a confusing completed "Add image" row
  //            alongside the "Replace placeholder" strong recommendation.
  //            When a claimed venue has no image at all, the required item is shown.

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
    // For claimed venues: only include the image item when there is no image at all.
    // When a placeholder image is present, the publish requirement is already met —
    // the "Replace placeholder" strong recommendation handles the image nudge.
    // For submitted venues: always include (completed only when they upload their own).
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

  // ── Tier 2: Strong Recommendations — high-priority, do not block publish ───
  //
  // Claimed venues see granular "verify imported data" tasks instead of generic
  // "add this field" prompts. Keys are prefixed with "claimedReview_" so the
  // page layer can render them in a dedicated verification section.
  // Submitted venues see the standard profile-completion items.

  const strongRecommendations: ReadinessItem[] = [
    ...(isClaimed
      ? [
          // ── Claimed venues: imported-data verification tasks ──────────────
          {
            key: "claimedReview_businessDetails",
            label: "Verify your business details",
            description:
              "Check that your imported address, phone number, and contact details are correct for your venue.",
            completed: hasAddressLine1 && hasCity && hasProvinceOrState,
          },
          {
            key: "claimedReview_venueType",
            label: "Confirm your venue type",
            description:
              "The imported venue type may not match your establishment. Set it correctly so guests can find you in the right searches.",
            completed: hasConfirmedVenueType,
          },
          {
            key: "claimedReview_businessHours",
            label: "Review your business hours",
            description:
              "Guests check hours before visiting. Make sure the imported schedule is accurate and up to date.",
            completed: hasBusinessHours,
          },
          {
            key: "claimedReview_hhSpecials",
            label: "Review or add your happy hour specials",
            description:
              "Food and drink deals are the #1 reason guests choose a venue. Review any imported items or add your own.",
            completed: hasFoodSpecials && hasDrinkSpecials,
          },
          {
            key: "claimedReview_image",
            label: "Upload your own venue photo",
            description:
              "Your listing shows a placeholder photo. Upload a real image of your venue to build guest trust and make a stronger impression.",
            completed: hasOperatorVenueImage,
          },
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
    // Menu link: valuable for all venues
    {
      key: "hasMenuLink",
      label: "Add menu link",
      description: "A menu link drives more confident, informed guest visits.",
      completed: hasMenuLink,
    },
  ];

  // ── Tier 3: Recommendations — nice-to-have, do not block publish ───────────
  // Copy is written as helpful suggestions, not admin checklist entries.

  const recommendations: ReadinessItem[] = [
    {
      key: "hasPhone",
      label: "Add a phone number",
      description: "Lets guests call ahead to check on specials, make a reservation, or ask questions.",
      completed: hasPhone,
    },
    {
      key: "hasWebsite",
      label: "Link your website",
      description: "Connects your listing to your main online presence so guests can learn more.",
      completed: hasWebsite,
    },
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
