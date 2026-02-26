import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import type { BusinessHours } from "@/app/dashboard/venues/_shared/types";
import BusinessHoursForm from "@/app/dashboard/venues/[id]/hours/BusinessHoursForm";
import BusinessDetailsForm from "./BusinessDetailsForm";
import PaymentTypesForm from "./PaymentTypesForm";
import LinksForm from "./LinksForm";
import CreateVenueAdminForm from "./CreateVenueAdminForm";
import AccordionSection from "./AccordionSection";

/**
 * Venue row as returned by Supabase select("*").
 * Column names match the actual DB schema (lat/lng, payment_types TEXT).
 */
type AdminVenueRow = {
  id: string;
  name: string;
  address_line1?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  website_url?: string | null;
  business_hours?: Record<string, unknown> | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** TEXT column — stored as a JSON array string, e.g. '["Visa","Cash"]' */
  payment_types?: string | null;
  menu_url?: string | null;
};

/**
 * Parses the `payment_types` TEXT column value back into a string array.
 *
 * The column stores a JSON-serialised array written by the Supabase JS client
 * (e.g. '["Visa","Cash"]'). Reading it back yields a string, not an array,
 * so we parse it here before passing it to the form.
 */
function parsePaymentTypes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // Fallback: treat as comma-separated (original schema intent)
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminVenuePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

  // Load this operator's single venue.
  // Ownership enforced by created_by_operator_id filter (+ RLS).
  const { data: venueData, error: venueError } = operator
    ? await supabase
        .from("venues")
        .select("*")
        .eq("created_by_operator_id", operator.id)
        .maybeSingle()
    : { data: null, error: null };

  const venue = venueData as AdminVenueRow | null;

  // Parse payment_types from TEXT column (JSON array string → string[]).
  const paymentTypes = parsePaymentTypes(venue?.payment_types);

  // Key for PaymentTypesForm — forces remount when stored payment types change
  // after router.refresh(), so controlled state re-initialises from fresh props.
  const paymentTypesKey = JSON.stringify(paymentTypes);

  return (
    <div className="max-w-2xl">
      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Venue</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage your venue details, hours, and settings.
        </p>
      </div>

      {/* Operator error */}
      {operatorError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}

      {/* Venue fetch error */}
      {venueError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
          <strong>Error loading venue:</strong> {venueError.message}
        </div>
      )}

      {/* ── No venue yet: setup prompt ────────────────────────────────────── */}
      {!operatorError && !venueError && operator && !venue && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-800 mb-1">
            Set up your venue
          </h3>
          <p className="text-sm text-gray-500 mb-5">
            Start by giving your venue a name. You can fill in all other details
            once it&rsquo;s created.
          </p>
          <CreateVenueAdminForm />
        </div>
      )}

      {/* ── Venue sections ────────────────────────────────────────────────── */}
      {!operatorError && operator && venue && (
        <div className="space-y-3">

          {/* Section 1: Business details — expanded by default */}
          <AccordionSection title="Business details" defaultOpen>
            <BusinessDetailsForm
              venueId={venue.id}
              initialValues={{
                name:          venue.name          ?? "",
                address_line1: venue.address_line1 ?? "",
                city:          venue.city          ?? "",
                region:        venue.region        ?? "",
                postal_code:   venue.postal_code   ?? "",
                phone:         venue.phone         ?? "",
                country:       venue.country       ?? "",
                lat:           venue.lat != null ? String(venue.lat) : "",
                lng:           venue.lng != null ? String(venue.lng) : "",
              }}
            />
          </AccordionSection>

          {/* Section 2: Business hours
              BusinessHoursForm is unchanged from its original location.
              On success it redirects to /dashboard → /admin/venue. */}
          <AccordionSection
            title="Business hours"
            description={
              'Check "Closed" for days the venue is not open. ' +
              "Overnight hours (e.g. 10 PM – 2 AM) are supported."
            }
          >
            <BusinessHoursForm
              venueId={venue.id}
              initialHours={(venue.business_hours as BusinessHours) ?? {}}
            />
          </AccordionSection>

          {/* Section 3: Payment types
              key forces remount when stored payment_types changes after
              router.refresh(), ensuring controlled checkboxes re-initialise. */}
          <AccordionSection title="Payment types">
            <PaymentTypesForm
              key={paymentTypesKey}
              venueId={venue.id}
              initialPaymentTypes={paymentTypes}
            />
          </AccordionSection>

          {/* Section 4: Links */}
          <AccordionSection title="Links">
            <LinksForm
              venueId={venue.id}
              initialValues={{
                website_url: venue.website_url ?? "",
                menu_url:    venue.menu_url    ?? "",
              }}
            />
          </AccordionSection>

        </div>
      )}
    </div>
  );
}
