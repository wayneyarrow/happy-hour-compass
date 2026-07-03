import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getVenueNotes } from "@/lib/data/venueNotes";
import { getVenueHealthData } from "@/lib/data/venueHealth";
import { getVenueFeaturedContent } from "@/lib/data/contentGuideAttachments";
import ImpersonateButton from "./ImpersonateButton";
import { ExcludeDiscoverControl } from "./ExcludeDiscoverControl";
import VenueNotesSection from "./VenueNotesSection";
import VenueHealthPanel from "./VenueHealthPanel";
import ReactivateVenuePanel from "./ReactivateVenuePanel";
import FeaturedInContentSection from "./FeaturedInContentSection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venue Detail" };

// ── Types ─────────────────────────────────────────────────────────────────────

type VenueDetail = {
  id: string;
  slug: string;
  name: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  // Location / contact
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  website_url: string | null;
  // Ownership / data context
  place_id: string | null;
  created_by_operator_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  is_verified: boolean;
  // Discovery controls
  internal_boost: number;
  spotlight_eligible: boolean;
  exclude_from_discover: boolean;
  // Cancellation lifecycle
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by_operator_id: string | null;
  // Operator plan / activity (via FK — may be null for unclaimed venues)
  operator_plan: string | null;
  operator_name: string | null;
  operator_email: string | null;
  operator_last_seen_at: string | null;
  // Setup/health inputs (used by the Health Panel — see venueHealth.ts)
  source: string | null;
  hh_times: string | null;
  business_hours: Record<string, unknown> | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function na(value: string | null | undefined): React.ReactNode {
  if (value == null || value === "") {
    return <span className="text-gray-400 italic">Not available</span>;
  }
  return value;
}

// ── Layout pieces ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        {title}
      </h2>
      {children}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="text-gray-400 w-44 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{children}</dd>
    </div>
  );
}

const PLAN_BADGE: Record<string, string> = {
  enterprise: "bg-purple-100 text-purple-700 border border-purple-300",
  premium:    "bg-amber-100  text-amber-700  border border-amber-300",
  pro:        "bg-sky-100    text-sky-700    border border-sky-300",
  free:       "bg-gray-100   text-gray-500   border border-gray-300",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ControlPanelVenueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  const [{ data, error }, { notes }, featuredContent] = await Promise.all([
    supabase
      .from("venues")
      .select(
        `id, slug, name, is_published, created_at, updated_at,
         address_line1, city, region, postal_code, country, phone, website_url,
         place_id, created_by_operator_id, claimed_by, claimed_at, is_verified,
         internal_boost, spotlight_eligible, exclude_from_discover,
         cancelled_at, cancellation_reason, cancelled_by_operator_id,
         source, hh_times, business_hours, hh_food_details, hh_drink_details,
         operators!created_by_operator_id(plan, name, email, last_seen_at)`
      )
      .eq("id", id)
      .maybeSingle(),
    getVenueNotes(id),
    getVenueFeaturedContent(id),
  ]);

  if (error) {
    return (
      <div className="max-w-2xl">
        <Link
          href="/control-panel/venues"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          ← Back to Venues
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          Error loading venue: {error.message}
        </div>
      </div>
    );
  }

  if (!data) {
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = data as Record<string, any>;

  // Supabase returns embedded relations as arrays when there are no generated types.
  const operatorRaw = v.operators;
  const operatorEmbed: Record<string, unknown> | null = Array.isArray(operatorRaw)
    ? (operatorRaw[0] ?? null)
    : (operatorRaw ?? null);
  const operatorPlan: string | null = (operatorEmbed?.plan as string | null) ?? null;
  const operatorName: string | null = (operatorEmbed?.name as string | null) ?? null;
  const operatorEmail: string | null = (operatorEmbed?.email as string | null) ?? null;
  const operatorLastSeenAt: string | null = (operatorEmbed?.last_seen_at as string | null) ?? null;

  const venue: VenueDetail = {
    id:                     v.id as string,
    slug:                   v.slug as string,
    name:                   v.name as string,
    is_published:           v.is_published as boolean,
    created_at:             v.created_at as string,
    updated_at:             v.updated_at as string,
    address_line1:          v.address_line1 as string | null,
    city:                   v.city as string | null,
    region:                 v.region as string | null,
    postal_code:            v.postal_code as string | null,
    country:                v.country as string | null,
    phone:                  v.phone as string | null,
    website_url:            v.website_url as string | null,
    place_id:               v.place_id as string | null,
    created_by_operator_id: v.created_by_operator_id as string | null,
    claimed_by:             v.claimed_by as string | null,
    claimed_at:             v.claimed_at as string | null,
    is_verified:            v.is_verified === true,
    internal_boost:         (v.internal_boost as number | null) ?? 0,
    spotlight_eligible:     v.spotlight_eligible === true,
    exclude_from_discover:  v.exclude_from_discover === true,
    cancelled_at:             v.cancelled_at as string | null,
    cancellation_reason:      v.cancellation_reason as string | null,
    cancelled_by_operator_id: v.cancelled_by_operator_id as string | null,
    operator_plan:          operatorPlan,
    operator_name:          operatorName,
    operator_email:         operatorEmail,
    operator_last_seen_at:  operatorLastSeenAt,
    source:                 v.source as string | null,
    hh_times:               v.hh_times as string | null,
    business_hours:         v.business_hours as Record<string, unknown> | null,
    hh_food_details:        v.hh_food_details as string | null,
    hh_drink_details:       v.hh_drink_details as string | null,
  };

  const health = await getVenueHealthData({
    venueId: venue.id,
    operatorId: venue.created_by_operator_id,
    isPublished: venue.is_published,
    isVerified: venue.is_verified,
    source: venue.source,
    hhTimes: venue.hh_times,
    businessHours: venue.business_hours,
    hhFoodDetails: venue.hh_food_details,
    hhDrinkDetails: venue.hh_drink_details,
    operatorName: venue.operator_name,
    operatorEmail: venue.operator_email,
    operatorLastSeenAt: venue.operator_last_seen_at,
    venueUpdatedAt: venue.updated_at,
  });

  const isClaimed = venue.claimed_by != null || venue.created_by_operator_id != null;
  const discoverStatus = venue.exclude_from_discover ? "Excluded" : "Active";

  return (
    <div className="max-w-6xl">
      {/* Back nav */}
      <Link
        href="/control-panel/venues"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        ← Back to Venues
      </Link>

      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{venue.name}</h1>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{venue.id}</p>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {venue.is_published ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                Published
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                Unpublished
              </span>
            )}
            {isClaimed ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                Claimed / owned
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                Unclaimed
              </span>
            )}
            {venue.is_verified && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                Verified ✓
              </span>
            )}
            {venue.exclude_from_discover && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                Excl. from Discover
              </span>
            )}
            {venue.cancelled_at && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 border border-rose-300">
                Churned
              </span>
            )}
          </div>
        </div>

        {/* Open this venue's Operator Admin in a new tab as founder/support */}
        <ImpersonateButton venueId={venue.id} />
      </div>

      {/* Two-column layout: existing detail cards (left) + Health Panel (right) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">

      <div className="space-y-5 min-w-0">
        {/* A. Core venue info */}
        <Section title="Core Info">
          <dl className="space-y-2.5">
            <MetaRow label="Name">{venue.name}</MetaRow>
            <MetaRow label="Slug">
              <span className="font-mono text-xs text-gray-700">{venue.slug}</span>
            </MetaRow>
            <MetaRow label="Venue ID">
              <span className="font-mono text-xs text-gray-700">{venue.id}</span>
            </MetaRow>
            <MetaRow label="Published">
              {venue.is_published ? (
                <span className="text-green-700 font-medium">Yes</span>
              ) : (
                <span className="text-gray-500">No</span>
              )}
            </MetaRow>
            <MetaRow label="Claimed / owned">
              {isClaimed ? (
                <span className="text-amber-700 font-medium">Yes</span>
              ) : (
                <span className="text-gray-500">No</span>
              )}
            </MetaRow>
            <MetaRow label="Verified">
              {venue.is_verified ? (
                <span className="text-blue-700 font-medium">Yes</span>
              ) : (
                <span className="text-gray-500">No</span>
              )}
            </MetaRow>
            <MetaRow label="Created">{fmt(venue.created_at)}</MetaRow>
            {venue.cancelled_at && (
              <>
                <MetaRow label="Cancelled">
                  <span className="text-rose-700 font-medium">{fmt(venue.cancelled_at)}</span>
                </MetaRow>
                <MetaRow label="Cancellation reason">
                  {venue.cancellation_reason ?? <span className="text-gray-400 italic">Not recorded</span>}
                </MetaRow>
              </>
            )}
          </dl>

          {venue.cancelled_at && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                Founder Actions
              </p>
              <ReactivateVenuePanel
                venueId={venue.id}
                cancelledAt={venue.cancelled_at}
                cancellationReason={venue.cancellation_reason}
              />
            </div>
          )}

        </Section>

        {/* B. Location / contact */}
        <Section title="Location & Contact">
          <dl className="space-y-2.5">
            <MetaRow label="Address">{na(venue.address_line1)}</MetaRow>
            <MetaRow label="City">{na(venue.city)}</MetaRow>
            <MetaRow label="Province / region">{na(venue.region)}</MetaRow>
            <MetaRow label="Postal code">{na(venue.postal_code)}</MetaRow>
            <MetaRow label="Country">{na(venue.country)}</MetaRow>
            <MetaRow label="Phone">{na(venue.phone)}</MetaRow>
            <MetaRow label="Website">
              {venue.website_url ? (
                <a
                  href={venue.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 hover:underline break-all"
                >
                  {venue.website_url}
                </a>
              ) : (
                <span className="text-gray-400 italic">Not available</span>
              )}
            </MetaRow>
          </dl>
        </Section>

        {/* C. Data / ownership context */}
        <Section title="Data & Ownership">
          <dl className="space-y-2.5">
            <MetaRow label="Place ID">
              {venue.place_id ? (
                <span className="font-mono text-xs text-gray-700">{venue.place_id}</span>
              ) : (
                <span className="text-gray-400 italic">Not available</span>
              )}
            </MetaRow>
            <MetaRow label="Operator ID">
              {venue.created_by_operator_id ? (
                <span className="font-mono text-xs text-gray-700">
                  {venue.created_by_operator_id}
                </span>
              ) : (
                <span className="text-gray-400 italic">Not available</span>
              )}
            </MetaRow>
            <MetaRow label="Claimed by">
              {venue.claimed_by ? (
                <span className="font-mono text-xs text-gray-700">{venue.claimed_by}</span>
              ) : (
                <span className="text-gray-400 italic">Not available</span>
              )}
            </MetaRow>
            <MetaRow label="Claimed at">{fmt(venue.claimed_at)}</MetaRow>
          </dl>
        </Section>

        {/* D. Discovery snapshot */}
        <Section title="Discovery">
          <dl className="space-y-2.5 mb-5">
            <MetaRow label="Operator plan">
              {venue.operator_plan ? (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                    PLAN_BADGE[venue.operator_plan] ?? PLAN_BADGE.free
                  }`}
                >
                  {venue.operator_plan}
                </span>
              ) : (
                <span className="text-gray-400 italic">Unclaimed / no plan</span>
              )}
            </MetaRow>
            <MetaRow label="Internal boost">
              <span className={venue.internal_boost > 0 ? "text-amber-700 font-medium" : "text-gray-500"}>
                {venue.internal_boost}
                {venue.internal_boost > 0 && (
                  <span className="ml-1.5 text-xs px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded">
                    Boosted
                  </span>
                )}
              </span>
            </MetaRow>
            <MetaRow label="Spotlight eligible">
              {venue.spotlight_eligible ? (
                <span className="text-blue-700 font-medium">Yes</span>
              ) : (
                <span className="text-gray-500">No</span>
              )}
            </MetaRow>
            <MetaRow label="Discover status">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  discoverStatus === "Active"
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {discoverStatus}
              </span>
            </MetaRow>
          </dl>

          {/* Exclude From Discover control */}
          <ExcludeDiscoverControl
            venueId={venue.id}
            initialValue={venue.exclude_from_discover}
          />

          <p className="mt-3 text-xs text-gray-400">
            Rail-level nix overrides can be managed on the{" "}
            <Link
              href="/control-panel/discover"
              className="text-amber-700 hover:underline"
            >
              Discover Management
            </Link>{" "}
            page.
          </p>
        </Section>

        {/* E. Featured in Content (Content Engine guides referencing this venue) */}
        <FeaturedInContentSection data={featuredContent} />

        {/* F. Internal notes */}
        <VenueNotesSection venueId={venue.id} initialNotes={notes} />
      </div>

        {/* Right column: Health Panel */}
        <VenueHealthPanel data={health} />

      </div>
    </div>
  );
}
