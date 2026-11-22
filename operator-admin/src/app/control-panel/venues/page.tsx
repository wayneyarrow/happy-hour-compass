export const dynamic = "force-dynamic";
export const metadata = { title: "Venues" };

import { createAdminClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { getControlPanelMarketOptions } from "@/lib/data/controlPanelMarketOptions";
import { resolveMarketAssignment, type MarketFilterOption } from "@/lib/marketFilter";
import VenuesTable, { type VenueRow } from "./VenuesTable";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";

type VenueDbRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  is_published: boolean;
  is_verified: boolean;
  claimed_at: string | null;
  updated_at: string;
  created_by_operator_id: string | null;
  market_id: string | null;
};

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ControlPanelVenuesPage() {
  // Authorize before any data read or render — see requireControlPanelAdmin.ts.
  await requireControlPanelAdmin();

  const supabase = createAdminClient();

  // Complete reads (PostgREST caps a single response at 1,000 rows — an
  // unpaginated select would silently truncate the list, and every count and
  // filter below runs in the browser over this dataset). Ordered by the
  // immutable primary key so an edit mid-read can't move a row between
  // pages; fetchAllRows() also verifies count/uniqueness. The table applies
  // its own default sort (updated_at desc), so fetch order isn't visible.
  let venuesData: VenueDbRow[] = [];
  let opsData: { id: string; email: string }[] = [];
  let marketOptions: MarketFilterOption[] = [];
  let venuesError: { message: string } | null = null;
  try {
    [venuesData, opsData, marketOptions] = await Promise.all([
      fetchAllRows<VenueDbRow>(
        supabase,
        "venues",
        "id, slug, name, city, is_published, is_verified, claimed_at, updated_at, created_by_operator_id, market_id",
        (q) => q,
        ["id"]
      ),
      // Operators so we can show the linked email per venue.
      fetchAllRows<{ id: string; email: string }>(supabase, "operators", "id, email", (q) => q, ["id"]),
      getControlPanelMarketOptions(),
    ]);
  } catch (e) {
    venuesError = { message: e instanceof Error ? e.message : String(e) };
  }

  // Build a quick id → email map for the join
  const opMap = new Map(opsData.map((op) => [op.id, op.email]));

  // Merge operator email + market assignment into each venue row
  const venues: VenueRow[] = venuesData.map((v) => ({
    id:            v.id,
    slug:          v.slug,
    name:          v.name,
    city:          v.city ?? null,
    is_published:  v.is_published,
    is_verified:   v.is_verified,
    claimed_at:    v.claimed_at ?? null,
    updated_at:    v.updated_at,
    operatorEmail: v.created_by_operator_id
      ? (opMap.get(v.created_by_operator_id) ?? null)
      : null,
    ...resolveMarketAssignment(v.market_id ?? null, marketOptions),
  }));

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Venues</h1>
          <p className="mt-1 text-sm text-gray-500">
            All venues on the platform — published status, claim state, verification status, and linked operator.
          </p>
        </div>
        {venues.length > 0 && (
          <span className="text-sm text-gray-500">
            {venues.length} {venues.length === 1 ? "venue" : "venues"} total
          </span>
        )}
      </div>

      {/* Error state */}
      {venuesError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          <strong>Error loading venues:</strong> {venuesError.message}
        </div>
      )}

      {/* Empty state */}
      {!venuesError && venues.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">No venues yet</h2>
          <p className="text-sm text-gray-500 max-w-xs mx-auto">
            Venues imported or created through the platform will appear here.
          </p>
        </div>
      )}

      {/* Venues table */}
      {!venuesError && venues.length > 0 && <VenuesTable rows={venues} marketOptions={marketOptions} />}
    </div>
  );
}
