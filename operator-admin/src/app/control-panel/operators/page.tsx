export const dynamic = "force-dynamic";
export const metadata = { title: "Operators" };

import { createAdminClient } from "@/lib/supabase/server";
import { highestPlan } from "@/lib/venueSubscriptions";
import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";
import OperatorsTable, { type OperatorRow } from "./OperatorsTable";

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ControlPanelOperatorsPage() {
  const supabase = createAdminClient();

  // Fetch all operators ordered by most recently created.
  // Phase 2B billing review (Part 8): operators.plan is no longer
  // authoritative once venue-level plans can diverge — it is intentionally
  // NOT selected/displayed here any more. See highestVenuePlan below.
  const { data: opsData, error: opsError } = await supabase
    .from("operators")
    .select("id, name, email, is_approved, created_at, updated_at")
    .order("created_at", { ascending: false });

  // Fetch venues so we can map operator → venue(s).
  const { data: venuesData } = await supabase
    .from("venues")
    .select("id, name, slug, created_by_operator_id");

  // Build operator_id → venue map (one venue per operator FOR DISPLAY —
  // pre-existing beta simplification, unchanged; a multi-venue operator's
  // additional venues are not shown as a second row here, same as before
  // Phase 2B). The plan computation below is separate and considers every
  // venue the operator owns, not just this displayed one.
  const venueMap = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (venuesData ?? []).map((v: Record<string, any>) => [
      v.created_by_operator_id as string,
      { name: v.name as string, slug: v.slug as string },
    ])
  );

  // Group ALL venue ids by operator, for the highest-venue-plan computation.
  const venueIdsByOperator = new Map<string, string[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of (venuesData ?? []) as Record<string, any>[]) {
    const opId = v.created_by_operator_id as string | null;
    if (!opId) continue;
    const list = venueIdsByOperator.get(opId) ?? [];
    list.push(v.id as string);
    venueIdsByOperator.set(opId, list);
  }

  // Batched per-venue plan lookup (venue_subscriptions; no row → 'free') —
  // one query for every venue across every operator, then reduced to a
  // highest-plan-per-operator map client-side. Never reads operators.plan.
  const allVenueIds = (venuesData ?? []).map((v) => v.id as string);
  const { data: venuePlanRows } = allVenueIds.length > 0
    ? await supabase.from("venue_subscriptions").select("venue_id, plan_code").in("venue_id", allVenueIds)
    : { data: [] as { venue_id: string; plan_code: string | null }[] };
  const planByVenueId = new Map(
    ((venuePlanRows ?? []) as { venue_id: string; plan_code: string | null }[]).map(
      (r) => [r.venue_id, parseOperatorPlan(r.plan_code)] as const
    )
  );

  function highestVenuePlanForOperator(operatorId: string): OperatorPlan {
    const venueIds = venueIdsByOperator.get(operatorId) ?? [];
    return highestPlan(venueIds.map((id) => planByVenueId.get(id) ?? "free"));
  }

  // Merge venue + plan data into each operator row.
  const operators: OperatorRow[] = (opsData ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (op: Record<string, any>) => {
      const venue = venueMap.get(op.id as string) ?? null;
      return {
        id:                op.id as string,
        name:              (op.name as string | null) ?? null,
        email:             op.email as string,
        is_approved:       op.is_approved as boolean,
        highestVenuePlan:  highestVenuePlanForOperator(op.id as string),
        venueName:         venue?.name ?? null,
        venueSlug:         venue?.slug ?? null,
        created_at:        op.created_at as string,
        updated_at:        op.updated_at as string,
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
