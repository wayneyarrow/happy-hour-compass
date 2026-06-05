import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import { parseOperatorPlan, maxSearchTags, maxImages } from "@/lib/plans";
import { getMembershipRole } from "@/lib/memberships";
import type { BusinessHours } from "@/app/dashboard/venues/_shared/types";
import BusinessHoursForm from "@/app/dashboard/venues/[id]/hours/BusinessHoursForm";
import BusinessDetailsForm from "./BusinessDetailsForm";
import PaymentTypesForm from "./PaymentTypesForm";
import LinksForm from "./LinksForm";
import SearchTagsForm from "./SearchTagsForm";
import CreateVenueAdminForm from "./CreateVenueAdminForm";
import AccordionSection from "./AccordionSection";
import VenueImagesSection from "./VenueImagesSection";
import VenuePublishSection from "./VenuePublishSection";

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
  is_published?: boolean | null;
  establishment_type?: string | null;
  /** PostgreSQL TEXT[] — returned as string[] by the Supabase client */
  search_tags?: string[] | null;
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

// ── Section id/name mapping ───────────────────────────────────────────────────

type VenueSection =
  | "business-details"
  | "business-hours"
  | "payment-types"
  | "links"
  | "search-tags"
  | "images"
  | "publish";

function isOpen(section: string | undefined, name: VenueSection): boolean {
  return section === name;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminVenuePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  // Auth guard: redirect unauthenticated users. During impersonation the CP
  // admin IS authenticated (their own Supabase session), so this passes.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve operator context — returns impersonated context when the
  // imp_session_id cookie is present and valid, otherwise normal context.
  const ctx = await resolveOperatorContext();
  const { operator, operatorError, isImpersonating, impersonatingVenueId } = ctx;

  const currentEmail = user.email ?? operator?.email ?? "";
  const currentRole = operator ? await getMembershipRole(operator.id, currentEmail) : null;
  const isOwner = isImpersonating || currentRole === "owner";

  // Load venue:
  //   Normal / Case A impersonation: filter by created_by_operator_id
  //   Case B impersonation (orphan):  filter directly by venue id
  let venueData: AdminVenueRow | null = null;
  let venueError: { message: string } | null = null;

  if (operator) {
    const { data, error } = await ctx.supabase
      .from("venues")
      .select("*")
      .eq("created_by_operator_id", operator.id)
      .maybeSingle();
    venueData = data as AdminVenueRow | null;
    venueError = error as { message: string } | null;
  } else if (isImpersonating && impersonatingVenueId) {
    const { data, error } = await ctx.supabase
      .from("venues")
      .select("*")
      .eq("id", impersonatingVenueId)
      .maybeSingle();
    venueData = data as AdminVenueRow | null;
    venueError = error as { message: string } | null;
  }

  const venue = venueData;

  // Parse payment_types from TEXT column (JSON array string → string[]).
  const paymentTypes = parsePaymentTypes(venue?.payment_types);

  // Key for PaymentTypesForm — forces remount when stored payment types change
  // after router.refresh(), so controlled state re-initialises from fresh props.
  const paymentTypesKey = JSON.stringify(paymentTypes);

  // Search tags — TEXT[] column returned as string[] by Supabase client.
  const currentSearchTags = Array.isArray(venue?.search_tags) ? venue.search_tags : [];
  const operatorPlan = parseOperatorPlan(operator?.plan);
  const tagLimit   = maxSearchTags(operatorPlan);
  const imageLimit = maxImages(operatorPlan);

  return (
    <div className="max-w-2xl">
      {/* Page heading */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Venue</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage your venue details, hours, and settings.
          </p>
        </div>
        {venue?.id && (
          <a
            href={`/venue/${venue.id}?preview=true`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors"
          >
            <span>Preview</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M7 17L17 7" />
              <path d="M7 7h10v10" />
            </svg>
          </a>
        )}
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

      {/* ── No venue yet: setup prompt (normal mode only, not during impersonation) */}
      {!operatorError && !venueError && operator && !venue && !isImpersonating && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
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

      {/* ── Venue sections (normal mode, or Case A/B impersonation with venue) */}
      {!operatorError && (operator || isImpersonating) && venue && (
        <div className="space-y-3">

          {/* Section 1: Business details — expanded by default or when deep-linked */}
          <AccordionSection
            id="business-details"
            title="Business details"
            defaultOpen={!section || isOpen(section, "business-details")}
          >
            <BusinessDetailsForm
              venueId={venue.id}
              initialValues={{
                name:               venue.name               ?? "",
                address_line1:      venue.address_line1      ?? "",
                city:               venue.city               ?? "",
                region:             venue.region             ?? "",
                postal_code:        venue.postal_code        ?? "",
                phone:              venue.phone              ?? "",
                country:            venue.country            ?? "",
                lat:                venue.lat != null ? String(venue.lat) : "",
                lng:                venue.lng != null ? String(venue.lng) : "",
                establishment_type: venue.establishment_type ?? "Restaurant and Bar",
              }}
            />
          </AccordionSection>

          {/* Section 2: Business hours */}
          <AccordionSection
            id="business-hours"
            title="Business hours"
            description={
              'Check "Closed" for days the venue is not open. ' +
              "Overnight hours (e.g. 10 PM – 2 AM) are supported."
            }
            defaultOpen={isOpen(section, "business-hours")}
          >
            <BusinessHoursForm
              venueId={venue.id}
              initialHours={(venue.business_hours as BusinessHours) ?? {}}
            />
          </AccordionSection>

          {/* Section 3: Payment types */}
          <AccordionSection
            id="payment-types"
            title="Payment types"
            defaultOpen={isOpen(section, "payment-types")}
          >
            <PaymentTypesForm
              key={paymentTypesKey}
              venueId={venue.id}
              initialPaymentTypes={paymentTypes}
            />
          </AccordionSection>

          {/* Section 4: Links */}
          <AccordionSection
            id="links"
            title="Links"
            defaultOpen={isOpen(section, "links")}
          >
            <LinksForm
              venueId={venue.id}
              initialValues={{
                website_url: venue.website_url ?? "",
                menu_url:    venue.menu_url    ?? "",
              }}
            />
          </AccordionSection>

          {/* Section 5: Search tags */}
          <AccordionSection
            id="search-tags"
            title="Search tags"
            description="Help customers discover your venue based on what makes it special."
            defaultOpen={isOpen(section, "search-tags")}
          >
            <SearchTagsForm
              venueId={venue.id}
              initialTags={currentSearchTags}
              plan={operatorPlan}
              tagLimit={tagLimit}
              isOwner={isOwner}
            />
          </AccordionSection>

          {/* Section 6: Images */}
          <AccordionSection
            id="images"
            title="Venue images"
            description={`Upload up to ${imageLimit} image${imageLimit === 1 ? "" : "s"}. The first image is used as the primary image.`}
            defaultOpen={isOpen(section, "images")}
          >
            <VenueImagesSection
              venueId={venue.id}
              establishmentType={venue.establishment_type}
              imageLimit={imageLimit}
              plan={operatorPlan}
              isOwner={isOwner}
            />
          </AccordionSection>

          {/* Section 6: Publish */}
          <AccordionSection
            id="publish"
            title="Publish"
            description="Make your venue visible to the public. At least one venue image is required."
            defaultOpen={isOpen(section, "publish")}
          >
            <VenuePublishSection
              venueId={venue.id}
              initialIsPublished={venue.is_published ?? false}
            />
          </AccordionSection>

        </div>
      )}
    </div>
  );
}
