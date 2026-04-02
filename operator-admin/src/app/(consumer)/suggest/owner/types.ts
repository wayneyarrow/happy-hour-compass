/**
 * Shared types for the operator submission flow (Phase 3A).
 * Used by both the client component and the server actions.
 */

/** Form values collected from the initial operator submission form. */
export type OwnerFormValues = {
  businessName: string;
  streetAddress: string;
  city: string;
  province: string;
  firstName: string;
  lastName: string;
  position: string;
  email: string;
};

/**
 * Structured Google Places match result returned by the backend lookup.
 *
 * All fields are nullable — the lookup may return partial data depending on
 * what the Places API has for a given business.
 *
 * rating and reviewCount are fetched and stored in google_match_json for later
 * use but are intentionally NOT displayed on the confirmation screen (by design).
 */
export type GoogleMatch = {
  placeId: string | null;
  /** Business name from Google displayName.text */
  name: string | null;
  /** Full formatted address string from Google */
  formattedAddress: string | null;
  /** Street address: street_number + route (e.g. "123 Main St") */
  streetAddress: string | null;
  city: string | null;
  province: string | null;
  /** Short/abbreviated province from Google addressComponents (e.g. "BC" for "British Columbia").
   *  Used by the confidence gate to match submitted abbreviations like "BC" against full names. */
  provinceShort: string | null;
  postalCode: string | null;
  country: string | null;
  /** Latitude from location.latitude */
  lat: number | null;
  /** Longitude from location.longitude */
  lng: number | null;
  /** International phone number (e.g. "+1 604-555-0100") */
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** First photo resource name (e.g. "places/ChIJ.../photos/Aaw...") */
  photoReference: string | null;
};

/** Result returned by lookupBusinessAction. */
export type LookupResult = {
  /** Best Google match, or null if none found or API unavailable. */
  match: GoogleMatch | null;
  /** General error message (non-field). */
  error?: string;
  /** Per-field validation errors. */
  fieldErrors?: Record<string, string>;
};

/** Payload passed to saveOperatorSubmissionAction. */
export type SavePayload = {
  formValues: OwnerFormValues;
  match: GoogleMatch | null;
  matchConfirmed: boolean;
  rejectionNotes?: string;
  website?: string;
  additionalNotes?: string;
};

/** Result returned by saveOperatorSubmissionAction. */
export type SaveResult = {
  success?: boolean;
  error?: string;
};
