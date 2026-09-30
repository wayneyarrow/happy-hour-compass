/**
 * Core logic for /api/track/venue-click — the Operator Admin "Intent"
 * metrics (venue_click_events, migration 043).
 *
 * Kept free of Next.js / Supabase imports so it can be exercised with fake
 * dependencies; the route handler supplies the real admin-client lookups.
 *
 * Identifier compatibility: the shared consumer venue shape exposes the
 * venue SLUG as `id` (and the database UUID separately as `venueUuid`), so
 * most existing trackers — HappyHourTimesCard, BusinessHoursRow,
 * VenueInfoRows — post a slug. This endpoint originally accepted only a UUID
 * and answered those requests with 400, so nothing was stored. It now
 * accepts either form and always stores the resolved venue UUID.
 */

export const VENUE_CLICK_TYPES = [
  "website",
  "menu",
  "hh_schedule_expand",
  "business_hours_expand",
] as const;

export type VenueClickType = (typeof VENUE_CLICK_TYPES)[number];

const VALID_CLICK_TYPES: ReadonlySet<string> = new Set(VENUE_CLICK_TYPES);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches the output shape of slugify() (src/lib/slugify.ts). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;

export type VenueIdentifier =
  | { kind: "uuid"; value: string }
  | { kind: "slug"; value: string };

/** Classifies a client-supplied venue identifier, or null if malformed. */
export function parseVenueIdentifier(raw: unknown): VenueIdentifier | null {
  if (typeof raw !== "string") return null;
  if (UUID_RE.test(raw)) return { kind: "uuid", value: raw.toLowerCase() };
  if (raw.length <= MAX_SLUG_LENGTH && SLUG_RE.test(raw)) {
    return { kind: "slug", value: raw };
  }
  return null;
}

export type VenueClickDeps = {
  /** Resolves the venue UUID (null = no such venue); a returned or thrown error is a lookup failure. */
  findVenueId: (
    identifier: VenueIdentifier
  ) => Promise<{ venueId: string | null; error: unknown }>;
  insertClick: (row: {
    venue_id: string;
    click_type: VenueClickType;
    session_id: string;
  }) => Promise<{ error: unknown }>;
  logError: (message: string, detail?: Record<string, unknown>) => void;
};

export type VenueClickResult = {
  status: 204 | 400 | 404 | 500;
  error?: string;
};

/**
 * Validates the payload, resolves the venue to its UUID and inserts one
 * venue_click_events row. Never reports success unless the row was written.
 */
export async function recordVenueClick(
  body: unknown,
  deps: VenueClickDeps
): Promise<VenueClickResult> {
  if (typeof body !== "object" || body === null) {
    return { status: 400, error: "Invalid body" };
  }
  const { venueId, clickType, sessionId } = body as Record<string, unknown>;

  const identifier = parseVenueIdentifier(venueId);
  if (!identifier) {
    return { status: 400, error: "Invalid venueId" };
  }
  if (typeof clickType !== "string" || !VALID_CLICK_TYPES.has(clickType)) {
    return { status: 400, error: "Invalid clickType" };
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { status: 400, error: "Invalid sessionId" };
  }

  let resolvedVenueId: string | null;
  try {
    const { venueId: found, error } = await deps.findVenueId(identifier);
    if (error) {
      deps.logError("venue lookup failed", { identifierKind: identifier.kind, clickType, error });
      return { status: 500, error: "Tracking unavailable" };
    }
    resolvedVenueId = found;
  } catch (err) {
    deps.logError("venue lookup threw", { identifierKind: identifier.kind, clickType, error: err });
    return { status: 500, error: "Tracking unavailable" };
  }

  if (!resolvedVenueId) {
    return { status: 404, error: "Unknown venue" };
  }

  try {
    const { error } = await deps.insertClick({
      venue_id: resolvedVenueId,
      click_type: clickType as VenueClickType,
      session_id: sessionId,
    });
    if (error) {
      deps.logError("insert failed", { venueId: resolvedVenueId, clickType, error });
      return { status: 500, error: "Tracking unavailable" };
    }
  } catch (err) {
    deps.logError("insert threw", { venueId: resolvedVenueId, clickType, error: err });
    return { status: 500, error: "Tracking unavailable" };
  }

  return { status: 204 };
}
