export const dynamic = "force-dynamic";
export const metadata = { title: "Operators" };

import { createAdminClient } from "@/lib/supabase/server";
import OperatorsTable, { type OperatorRow } from "./OperatorsTable";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ControlPanelOperatorsPage() {
  const supabase = createAdminClient();

  // Fetch all operators ordered by most recently created
  const { data: opsData, error: opsError } = await supabase
    .from("operators")
    .select("id, name, email, is_approved, created_at")
    .order("created_at", { ascending: false });

  // Fetch venues so we can map operator → venue
  const { data: venuesData } = await supabase
    .from("venues")
    .select("id, name, slug, created_by_operator_id");

  // Build operator_id → venue map (one venue per operator in beta)
  const venueMap = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (venuesData ?? []).map((v: Record<string, any>) => [
      v.created_by_operator_id as string,
      { name: v.name as string, slug: v.slug as string },
    ])
  );

  // Merge venue data into each operator row
  const operators: OperatorRow[] = (opsData ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (op: Record<string, any>) => {
      const venue = venueMap.get(op.id as string) ?? null;
      return {
        id:          op.id as string,
        name:        (op.name as string | null) ?? null,
        email:       op.email as string,
        is_approved: op.is_approved as boolean,
        venueName:   venue?.name ?? null,
        venueSlug:   venue?.slug ?? null,
        created_at:  formatDate(op.created_at as string),
      };
    }
  );

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operators</h1>
          <p className="mt-1 text-sm text-gray-500">
            All operator accounts and their linked venues.
          </p>
        </div>
        {operators.length > 0 && (
          <span className="text-sm text-gray-500">
            {operators.length} {operators.length === 1 ? "operator" : "operators"}
          </span>
        )}
      </div>

      {/* Error state */}
      {opsError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          <strong>Error loading operators:</strong> {opsError.message}
        </div>
      )}

      {/* Empty state */}
      {!opsError && operators.length === 0 && (
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
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">No operators yet</h2>
          <p className="text-sm text-gray-500 max-w-xs mx-auto">
            Operator accounts created through the platform will appear here.
          </p>
        </div>
      )}

      {/* Operators table */}
      {!opsError && operators.length > 0 && <OperatorsTable rows={operators} />}
    </div>
  );
}
