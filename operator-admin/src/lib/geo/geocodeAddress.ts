/**
 * Address-only geocoding fallback for operator-submission venue creation.
 *
 * Context: `approveAndCreateVenueAction()` normally sources a venue's
 * lat/lng from the submission's `google_match_json` — populated when the
 * business-name lookup (`searchGooglePlace()`,
 * `(consumer)/suggest/owner/actions.ts`) found a confident match at
 * submission time. When that lookup returns `no_match` (a real, non-rare
 * outcome — e.g. a restaurant operating inside a hotel and indexed under
 * the hotel's name, like "The Placery" inside "Hyatt Place Kelowna"),
 * `google_match_json` is `null` and there was previously no fallback:
 * the venue was created with permanently null coordinates, which silently
 * excludes it from map markers and from the desktop Happy Hour discovery
 * grid (`filterCardsWithinBounds()`,
 * `(website)/website-happy-hours/HappyHoursSearchClient.tsx`) — see the
 * diagnosis writeup for "The Placery" (venue id
 * fe324b1e-12cf-4ce6-ac28-2370f2c3e126) for the full trace.
 *
 * This module resolves coordinates from the submitter's *street address*
 * instead of a business name. It deliberately reuses the exact same Google
 * Places API (New) Text Search endpoint, auth header, and error-handling
 * conventions already established by `searchGooglePlace()` — Text Search
 * accepts a full street address as its query and returns a location for it
 * (documented Google behavior; it isn't limited to named businesses), so
 * this is a small extension of the existing integration rather than a
 * second Google API surface, credential, or billing line item.
 *
 * Never fabricates or guesses coordinates: returns `{ ok: false }` on a
 * missing API key, network/API failure, no results, or a result whose
 * city/province don't plausibly match what the submitter entered. Callers
 * must treat `{ ok: false }` as "geography unresolved" — see
 * `approveAndCreateVenueAction()`, which still creates the venue
 * (unpublished, geography-incomplete) rather than blocking the whole
 * approval on a geocoding failure, mirroring how `resolveVenueGeography()`
 * already handles an unresolved market/city.
 */

import { normalizeGeographyText } from "./venueGeographyResolver";

// ── Google Places API (New) constants ─────────────────────────────────────────
// Same base URL / header shape as searchGooglePlace()
// ((consumer)/suggest/owner/actions.ts) and scripts/enrichMissingGeoKelowna.ts.

const PLACES_API_BASE = "https://places.googleapis.com/v1";

const GEOCODE_FIELD_MASK = [
  "places.formattedAddress",
  "places.location",
  "places.addressComponents",
].join(",");

// ── Public types ───────────────────────────────────────────────────────────────

export type AddressGeocodeInput = {
  streetAddress: string;
  city: string;
  /** Province/state — full name or abbreviation, matched loosely against Google's long/short forms. */
  province: string;
  postalCode?: string | null;
};

export type AddressGeocodeResult =
  | { ok: true; lat: number; lng: number; formattedAddress: string }
  | { ok: false; reason: string };

// ── Address component extraction ───────────────────────────────────────────────

function extractComponent(
  components: Record<string, unknown>[],
  type: string,
  field: "longText" | "shortText"
): string | null {
  const match = components.find(
    (c) => Array.isArray(c.types) && (c.types as string[]).includes(type)
  );
  return (match?.[field] as string | undefined) ?? null;
}

// ── Public: address geocoding ─────────────────────────────────────────────────

/**
 * Resolves lat/lng from a raw street address via Google Places API (New)
 * Text Search — no business name involved.
 *
 * Validation: the result must resolve to a locality matching the submitted
 * city and an administrative_area_level_1 (province/state) matching the
 * submitted province (compared against both Google's long and short forms,
 * same as the confidence-gate pattern in searchGooglePlace()'s caller).
 * This is the only safety check available for an address-only geocode — it
 * exists specifically to reject a wildly wrong result (e.g. a malformed
 * address resolving to a different city/province) rather than silently
 * trusting whatever Google returns.
 *
 * Returns `{ ok: false }` — never invented coordinates — when: the API key
 * is missing, required input fields are missing, the request fails, no
 * results are returned, or the result fails city/province validation.
 */
export async function geocodeStreetAddress(
  input: AddressGeocodeInput
): Promise<AddressGeocodeResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.error(
      "[geocodeStreetAddress] GOOGLE_PLACES_API_KEY is not configured."
    );
    return { ok: false, reason: "Geocoding is not configured (missing API key)." };
  }

  const street = input.streetAddress?.trim();
  const city = input.city?.trim();
  const province = input.province?.trim();

  if (!street || !city || !province) {
    return {
      ok: false,
      reason: "Insufficient address fields to geocode (street address, city, and province are required).",
    };
  }

  const textQuery = [street, city, province, input.postalCode?.trim(), "Canada"]
    .filter(Boolean)
    .join(", ");

  let data: Record<string, unknown>;
  try {
    const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GEOCODE_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery }),
      cache: "no-store",
    });

    if (!res.ok) {
      let errorBody: unknown = null;
      try {
        errorBody = await res.json();
      } catch {
        // Ignore — body may not be JSON.
      }
      console.error(
        "[geocodeStreetAddress] Places API error — status:",
        res.status,
        res.statusText,
        "— body:",
        JSON.stringify(errorBody)
      );
      return { ok: false, reason: `Places API HTTP ${res.status}` };
    }

    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[geocodeStreetAddress] Places API fetch error:", err);
    return {
      ok: false,
      reason: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const places = data.places as Record<string, unknown>[] | undefined;
  if (!places?.length) {
    return { ok: false, reason: "No geocoding results for the submitted address." };
  }

  const p = places[0] as Record<string, unknown>;
  const location = p.location as { latitude?: number; longitude?: number } | undefined;
  const components = (p.addressComponents as Record<string, unknown>[]) ?? [];
  const formattedAddress = typeof p.formattedAddress === "string" ? p.formattedAddress : "";

  if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") {
    return { ok: false, reason: "Geocoding result had no coordinates." };
  }

  // Validate: reject a result whose city/province clearly disagree with what
  // was submitted — this is the only guard available for an address-only
  // geocode (there is no business identity to confirm against).
  const resultCity =
    extractComponent(components, "locality", "longText") ??
    extractComponent(components, "sublocality_level_1", "longText");
  const resultProvinceShort = extractComponent(components, "administrative_area_level_1", "shortText");
  const resultProvinceLong = extractComponent(components, "administrative_area_level_1", "longText");

  const cityOk =
    resultCity != null && normalizeGeographyText(resultCity) === normalizeGeographyText(city);
  const provinceOk =
    normalizeGeographyText(province) === normalizeGeographyText(resultProvinceShort) ||
    normalizeGeographyText(province) === normalizeGeographyText(resultProvinceLong);

  if (!cityOk || !provinceOk) {
    console.warn("[geocodeStreetAddress] Rejected — city/province mismatch.", {
      submittedCity: city,
      submittedProvince: province,
      resultCity,
      resultProvinceShort,
      resultProvinceLong,
    });
    return {
      ok: false,
      reason:
        `Geocoded result did not match the submitted city/province ` +
        `(got city="${resultCity}", province="${resultProvinceShort ?? resultProvinceLong}").`,
    };
  }

  return {
    ok: true,
    lat: location.latitude,
    lng: location.longitude,
    formattedAddress,
  };
}
