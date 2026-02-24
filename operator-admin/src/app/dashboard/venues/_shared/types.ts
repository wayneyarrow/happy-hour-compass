/**
 * Fields submitted by both the Create Venue and Edit Venue forms.
 * Mirrors the editable columns in public.venues (ownership fields excluded).
 */
export type VenueFormValues = {
  name: string;
  address_line1: string;
  city: string;
  region: string;
  postal_code: string;
  phone: string;
  website_url: string;
};

/** Generic state shape returned by create/update server actions. */
export type VenueFormState = {
  errors?: Partial<Record<keyof VenueFormValues | "form", string>>;
  values?: VenueFormValues;
};

// ── Business Hours ────────────────────────────────────────────────────────────

/** Day-of-week keys exactly as stored in the JSONB column. */
export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/**
 * Opening/closing time pair. Times are 24-hour "HH:MM" strings.
 * open > close is a valid overnight window (e.g. 22:00–02:00).
 * open === close is invalid and rejected by the server action.
 */
export type DayHours = {
  open: string;  // "HH:MM" 24-hour
  close: string; // "HH:MM" 24-hour
};

/**
 * Full business-hours map stored in venues.business_hours (JSONB).
 * A null value for a key means the venue is closed that day.
 * A missing key is treated as not-yet-set (equivalent to closed).
 */
export type BusinessHours = {
  [K in DayOfWeek]?: DayHours | null;
};

/** State returned by the updateBusinessHoursAction server action. */
export type BusinessHoursFormState = {
  /** Per-day errors keyed by DayOfWeek, plus an optional "form" key for
   *  top-level errors (auth, DB, etc.). */
  errors?: Partial<Record<DayOfWeek | "form", string>>;
  /** The hours the user submitted — returned on validation failure so the
   *  client can restore the user's last input. */
  hours?: BusinessHours;
};
