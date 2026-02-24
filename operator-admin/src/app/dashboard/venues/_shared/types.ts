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
