// Always fetch fresh data — bypasses Next.js full-route and router caches.
export const dynamic = "force-dynamic";
export const metadata = { title: "Daily Specials" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext, assertActiveVenueSelected } from "@/lib/impersonation";
import { getMembershipRole } from "@/lib/memberships";
import DailySpecialsManager from "./DailySpecialsManager";
import { DAILY_SPECIAL_COLUMNS } from "./columns";
import EmptyState from "@/components/EmptyState";
import type { DailySpecialRow } from "./formState";

export default async function AdminDailySpecialsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await resolveOperatorContext();
  const { operator, operatorError, isImpersonating } = ctx;

  // Redirects to /admin/select-venue if this operator owns 2+ venues and
  // hasn't chosen one yet. No-op otherwise (0/1 venues, or impersonating).
  assertActiveVenueSelected(ctx);

  const currentEmail = user.email ?? operator?.email ?? "";
  const currentRole = operator ? await getMembershipRole(operator.id, currentEmail) : null;
  const isOwner = isImpersonating || currentRole === "owner";

  // Load the active venue — server-validated by resolveOperatorContext().
  let venueData: { id: string; name: string } | null = null;
  let venueError: { message: string } | null = null;

  if (ctx.activeVenueId) {
    let query = ctx.supabase.from("venues").select("id, name").eq("id", ctx.activeVenueId);
    if (operator) {
      query = query.eq("created_by_operator_id", operator.id);
    }
    const { data, error } = await query.maybeSingle();
    venueData = data as { id: string; name: string } | null;
    venueError = error as { message: string } | null;
  }

  const venue = venueData;

  // True only for founder impersonation of an unclaimed venue (Case B) —
  // mirrors the isUnclaimedVenueSupportMode check in saveDailySpecialAction,
  // so the client-side schedule-type picker isn't gated when the server
  // would actually allow support-mode recurring creation. Always false for
  // claimed-venue impersonation (Case A) and normal operator logins.
  const isUnclaimedVenueSupportMode = isImpersonating && !operator;

  // Daily Specials are manageable whenever a venue was resolved above —
  // either a claimed venue owned by the current operator (Case A / normal
  // login), or an unassigned venue under founder impersonation (Case B).
  // DailySpecialsManager/DailySpecialForm and the save/delete/image actions
  // handle a null operator explicitly (see actions.ts) — no separate
  // founder UI needed.
  const canManageDailySpecials = !!venue;

  const { data: specialsData, error: specialsError } =
    canManageDailySpecials
      ? await ctx.supabase
          .from("daily_specials")
          .select(DAILY_SPECIAL_COLUMNS)
          .eq("venue_id", venue!.id)
          .order("updated_at", { ascending: false })
      : { data: null, error: null };

  const initialSpecials = (specialsData as unknown as DailySpecialRow[] | null) ?? [];

  return (
    <div>
      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Daily Specials</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage food and drink specials for your venue — one-time or weekly.
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

      {/* No venue yet (normal mode only) */}
      {!operatorError && !venueError && operator && !venue && !isImpersonating && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-resting">
          <EmptyState
            title="No venue set up yet"
            description="Set up your venue before adding Daily Specials."
            cta={{ label: "Go to Venue →", href: "/admin/venue" }}
          />
        </div>
      )}

      {/* Non-fatal load error */}
      {canManageDailySpecials && specialsError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
          <strong>Note:</strong> Could not load existing Daily Specials. You can still
          create a new one.
        </div>
      )}

      {/* Daily Specials manager — list + form. Ownership scoping (Case A
          operator vs. Case B founder impersonation of an unassigned venue)
          is resolved server-side inside the save/delete/image actions via
          resolveOperatorContext() — no operator id needs to cross the wire. */}
      {!operatorError && canManageDailySpecials && (
        <DailySpecialsManager
          initialSpecials={initialSpecials}
          venueId={venue!.id}
          operatorPlan={ctx.activeVenuePlan}
          isOwner={isOwner}
          isUnclaimedVenueSupportMode={isUnclaimedVenueSupportMode}
        />
      )}
    </div>
  );
}
