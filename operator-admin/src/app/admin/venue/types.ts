// State and constant types shared between server actions (actions.ts) and
// client form components. Kept in a separate file because "use server" modules
// may only export async functions — not types or plain-object constants.

export type CreateVenueAdminState = {
  errors?: { form?: string; name?: string };
  values?: { name: string };
};

export type BusinessDetailsState = {
  success?: boolean;
  errors?: Partial<Record<"form" | "name", string>>;
  values?: {
    name: string;
    address_line1: string;
    city: string;
    region: string;
    postal_code: string;
    phone: string;
    country: string;
    lat: string;
    lng: string;
  };
};

export type PaymentTypesState = {
  success?: boolean;
  errors?: { form?: string };
};

export type LinksState = {
  success?: boolean;
  errors?: Partial<Record<"form" | "website_url" | "menu_url", string>>;
  values?: { website_url: string; menu_url: string };
};

export const PAYMENT_OPTIONS = [
  "Cash",
  "Debit",
  "Visa",
  "MasterCard",
  "Amex",
] as const;
