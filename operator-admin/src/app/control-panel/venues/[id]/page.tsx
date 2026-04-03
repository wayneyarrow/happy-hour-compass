import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ControlPanelVenueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("venues")
    .select(
      `id, slug, name, is_published, created_at,
       address_line1, city, region, postal_code, country, phone, website_url,
       place_id, created_by_operator_id, claimed_by, claimed_at`
    )
    .eq("id", id)
    .maybeSingle();

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
  };

  const isClaimed = venue.claimed_by != null || venue.created_by_operator_id != null;

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
      <div className="mb-6 flex items-start gap-3 flex-wrap">
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
        </div>
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
      </div>
    </div>
  );
}
