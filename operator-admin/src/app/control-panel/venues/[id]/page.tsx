import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getVenueNotes } from "@/lib/data/venueNotes";
import ImpersonateButton from "./ImpersonateButton";
import { ExcludeDiscoverControl } from "./ExcludeDiscoverControl";
import VenueNotesSection from "./VenueNotesSection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venue Detail" };

// ── Types ─────────────────────────────────────────────────────────────────────

type VenueDetail = {
  id: string;
  slug: string;
  name: string;
  is_published: boolean;
  created_at: string;
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
  // Operator plan (via FK — may be null for unclaimed venues)
  operator_plan: string | null;
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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
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

  const [{ data, error }, { notes }] = await Promise.all([
    supabase
      .from("venues")
      .select(
        `id, slug, name, is_published, created_at,
         address_line1, city, region, postal_code, country, phone, website_url,
         place_id, created_by_operator_id, claimed_by, claimed_at, is_verified,
         internal_boost, spotlight_eligible, exclude_from_discover,
         operators!created_by_operator_id(plan)`
      )
      .eq("id", id)
      .maybeSingle(),
    getVenueNotes(id),
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
  const operatorPlan: string | null = Array.isArray(operatorRaw)
    ? (operatorRaw[0]?.plan as string | null) ?? null
    : (operatorRaw?.plan as string | null) ?? null;

  const venue: VenueDetail = {
    id:                     v.id as string,
    slug:                   v.slug as string,
    name:                   v.name as string,
    is_published:           v.is_published as boolean,
    created_at:             v.created_at as string,
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
    operator_plan:          operatorPlan,
  };

  const isClaimed = venue.claimed_by != null || venue.created_by_operator_id != null;
  const discoverStatus = venue.exclude_from_discover ? "Excluded" : "Active";

  return (
    <div className="max-w-3xl">
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
          </div>
        </div>

        {/* Open this venue's Operator Admin in a new tab as founder/support */}
        <ImpersonateButton venueId={venue.id} />
      </div>

      <div className="space-y-5">
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
          </dl>
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

        {/* E. Internal notes */}
        <VenueNotesSection venueId={venue.id} initialNotes={notes} />
      </div>
    </div>
  );
}
