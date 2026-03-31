export const dynamic = "force-dynamic";
export const metadata = { title: "Venues" };

import { createAdminClient } from "@/lib/supabase/server";
import VenuesTable, { type VenueRow } from "./VenuesTable";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ControlPanelVenuesPage() {
  const supabase = createAdminClient();

  // Fetch venues ordered by most-recently-updated first
  const { data: venuesData, error: venuesError } = await supabase
    .from("venues")
    .select(
      "id, slug, name, city, is_published, claimed_at, updated_at, created_by_operator_id"
    )
    .order("updated_at", { ascending: false });

  // Fetch operators so we can show the linked email per venue
  const { data: opsData } = await supabase
    .from("operators")
    .select("id, email");

  // Build a quick id → email map for the join
  const opMap = new Map(
    (opsData ?? []).map((op: { id: string; email: string }) => [op.id, op.email])
  );

  // Merge operator email into each venue row
  const venues: VenueRow[] = (venuesData ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (v: Record<string, any>) => ({
      id:            v.id as string,
      slug:          v.slug as string,
      name:          v.name as string,
      city:          (v.city as string | null) ?? null,
      is_published:  v.is_published as boolean,
      claimed_at:    (v.claimed_at as string | null) ?? null,
      updated_at:    formatDate(v.updated_at as string),
      operatorEmail: v.created_by_operator_id
        ? (opMap.get(v.created_by_operator_id as string) ?? null)
        : null,
    })
  );

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Venues</h1>
          <p className="mt-1 text-sm text-gray-500">
            All venues on the platform — published status, claim state, and linked operator.
          </p>
        </div>
        {venues.length > 0 && (
          <span className="text-sm text-gray-500">
            {venues.length} {venues.length === 1 ? "venue" : "venues"}
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
      {!venuesError && venues.length > 0 && <VenuesTable rows={venues} />}
    </div>
  );
}
