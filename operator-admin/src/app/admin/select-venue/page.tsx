export const dynamic = "force-dynamic";
export const metadata = { title: "Select a venue" };

import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import { selectActiveVenueAction } from "./actions";

/**
 * Shown after login when the operator manages more than one venue — see
 * assertActiveVenueSelected() in src/lib/impersonation.ts, which is what
 * redirects here from every other venue-scoped Admin page. Not reachable
 * (redirects straight to /admin/home) for an operator who owns 0 or 1
 * venues — the current single-venue experience is unchanged for them.
 *
 * Deliberately does NOT call assertActiveVenueSelected() itself — that would
 * redirect this page to itself.
 */
export default async function SelectVenuePage() {
  const ctx = await resolveOperatorContext();

  if (!ctx.operator) {
    redirect("/login");
  }

  if (ctx.venues.length <= 1) {
    // Nothing to choose between — send straight to the dashboard.
    redirect("/admin/home");
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Choose a venue</h1>
        <p className="text-sm text-gray-500 mb-6">
          Your account manages more than one venue. Select which one you&rsquo;d like to work on.
        </p>
        <div className="space-y-2">
          {ctx.venues.map((venue) => (
            <form key={venue.id} action={selectActiveVenueAction}>
              <input type="hidden" name="venueId" value={venue.id} />
              <button
                type="submit"
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 hover:border-amber-400 hover:bg-amber-50 transition-colors text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">
                    {venue.name}
                  </span>
                  {(venue.city || venue.region) && (
                    <span className="block text-xs text-gray-500 truncate">
                      {[venue.city, venue.region].filter(Boolean).join(", ")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-amber-600 text-sm font-medium">
                  Select &rarr;
                </span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
