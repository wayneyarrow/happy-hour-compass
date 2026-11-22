export const dynamic = "force-dynamic";
export const metadata = { title: "Operators" };

import { createAdminClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { highestPlan } from "@/lib/venueSubscriptions";
import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";
import OperatorsTable, { type OperatorRow } from "./OperatorsTable";
import { getControlPanelMarketOptions } from "@/lib/data/controlPanelMarketOptions";
import { resolveMarketAssignment, type MarketFilterOption } from "@/lib/marketFilter";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";

type OperatorDbRow = { id: string; name: string | null; email: string; is_approved: boolean; created_at: string; updated_at: string };
type VenueDbRow = { id: string; name: string; slug: string; created_by_operator_id: string | null; market_id: string | null };

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ControlPanelOperatorsPage() {
  // Authorize before any data read or render — see requireControlPanelAdmin.ts.
  await requireControlPanelAdmin();

  const supabase = createAdminClient();

  // Scope (unchanged): one row per `operators` account. Team members
  // (operator_memberships) are not operator accounts and are not listed.
  //
  // Phase 2B billing review (Part 8): operators.plan is no longer
  // authoritative once venue-level plans can diverge — it is intentionally
  // NOT selected/displayed here any more. See highestVenuePlan below.
  //
  // Complete reads (past PostgREST's 1,000-row cap, ordered by id — see
  // fetchAllRows()) so the table's filters and counts cover every operator
  // and every owned venue.
  let opsData: OperatorDbRow[] = [];
  let venuesData: VenueDbRow[] = [];
  let marketOptions: MarketFilterOption[] = [];
  let opsError: { message: string } | null = null;
  try {
    [opsData, venuesData, marketOptions] = await Promise.all([
      fetchAllRows<OperatorDbRow>(supabase, "operators", "id, name, email, is_approved, created_at, updated_at", (q) => q, ["id"]),
      // Owned venues only — the only ones attributed to an operator.
      fetchAllRows<VenueDbRow>(
        supabase,
        "venues",
        "id, name, slug, created_by_operator_id, market_id",
        (q) => q.not("created_by_operator_id", "is", null),
        ["id"]
      ),
      getControlPanelMarketOptions(),
    ]);
  } catch (e) {
    opsError = { message: e instanceof Error ? e.message : String(e) };
  }
  // Most recently created first, as before.
  opsData.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Every venue each operator owns (for markets + plan). The table still
  // shows one venue per operator for display — the pre-existing beta
  // simplification — preferring one in the selected market.
  const venuesByOperator = new Map<string, VenueDbRow[]>();
  for (const v of venuesData) {
    const opId = v.created_by_operator_id;
    if (!opId) continue;
    const list = venuesByOperator.get(opId) ?? [];
    list.push(v);
    venuesByOperator.set(opId, list);
  }

  // Batched per-venue plan lookup (venue_subscriptions; no row → 'free') for
  // owned venues only, in chunks so the .in() list stays a safe size. Never
  // reads operators.plan.
  const ownedVenueIds = venuesData.map((v) => v.id);
  const planByVenueId = new Map<string, OperatorPlan>();
  for (let i = 0; i < ownedVenueIds.length; i += 200) {
    const chunk = ownedVenueIds.slice(i, i + 200);
    const { data: planRows } = await supabase.from("venue_subscriptions").select("venue_id, plan_code").in("venue_id", chunk);
    for (const r of (planRows ?? []) as { venue_id: string; plan_code: string | null }[]) {
      planByVenueId.set(r.venue_id, parseOperatorPlan(r.plan_code));
    }
  }

  function highestVenuePlanForOperator(operatorId: string): OperatorPlan {
    const venues = venuesByOperator.get(operatorId) ?? [];
    return highestPlan(venues.map((v) => planByVenueId.get(v.id) ?? "free"));
  }

  // Merge venue + plan + market data into each operator row.
  const operators: OperatorRow[] = opsData.map((op) => {
    const owned = venuesByOperator.get(op.id) ?? [];
    const display = owned[owned.length - 1] ?? null;
    return {
      id:               op.id,
      name:             op.name ?? null,
      email:            op.email,
      is_approved:      op.is_approved,
      highestVenuePlan: highestVenuePlanForOperator(op.id),
      venueId:          display?.id ?? null,
      venueName:        display?.name ?? null,
      venueSlug:        display?.slug ?? null,
      ownedVenues: owned.map((v) => ({
        id: v.id,
        name: v.name,
        slug: v.slug,
        ...resolveMarketAssignment(v.market_id ?? null, marketOptions),
      })),
      created_at:       op.created_at,
      updated_at:       op.updated_at,
    };
  });

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
            {operators.length} {operators.length === 1 ? "operator" : "operators"} total
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
      {!opsError && operators.length > 0 && <OperatorsTable rows={operators} marketOptions={marketOptions} />}
    </div>
  );
}
