import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";

// Server Component — resolves auth and operator, then renders the happy hours
// management page. Full happy-hour DB logic will be wired in a later task.
export default async function AdminHappyHoursPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

  // Load venue so we can confirm one exists before showing the form.
  const { data: venue } = operator
    ? await supabase
        .from("venues")
        .select("id, name")
        .eq("created_by_operator_id", operator.id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Happy Hours</h2>
        {venue?.name && (
          <p className="text-sm text-gray-500 mt-1">{venue.name}</p>
        )}
      </div>

      {operatorError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
          <strong>Account issue:</strong> {operatorError}
        </div>
      )}

      {operator && venue && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          {/* Placeholder structure ready for happy-hour logic integration */}
          <div className="text-sm text-gray-500">
            <p className="font-medium text-gray-700 mb-1">
              Happy hour configuration
            </p>
            <p>
              Define the days and times when your happy hour deals are active.
              Full scheduling options are coming soon.
            </p>
          </div>

          {/* Form structure placeholder — each field group will be wired
              to a server action when happy-hour DB logic is implemented. */}
          <div className="space-y-4 pt-2 opacity-50 pointer-events-none select-none">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Active days
              </p>
              <div className="flex flex-wrap gap-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                  (day) => (
                    <span
                      key={day}
                      className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-500"
                    >
                      {day}
                    </span>
                  )
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Time window
              </p>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span className="px-3 py-1.5 border border-gray-200 rounded-lg bg-gray-50 text-xs">
                  Start time
                </span>
                <span>–</span>
                <span className="px-3 py-1.5 border border-gray-200 rounded-lg bg-gray-50 text-xs">
                  End time
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
            This section will be fully functional in an upcoming release.
          </p>
        </div>
      )}

      {operator && !venue && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-600">No venue set up yet</p>
          <p className="text-xs text-gray-400 mt-1">
            Set up your venue before configuring happy hours.
          </p>
        </div>
      )}
    </div>
  );
}
