import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import Link from "next/link";
import BusinessHoursForm from "./BusinessHoursForm";
import type { BusinessHours } from "../../_shared/types";

// In Next.js 15 the params object is a Promise.
type PageProps = { params: Promise<{ id: string }> };

// Server Component — resolves auth, operator, and venue before rendering.
export default async function BusinessHoursPage({ params }: PageProps) {
  const { id } = await params;

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

  // Fetch venue name + existing hours, scoped to this operator.
  const { data: venue, error: venueError } = operator
    ? await supabase
        .from("venues")
        .select("id, name, business_hours")
        .eq("id", id)
        .eq("created_by_operator_id", operator.id)
        .maybeSingle()
    : { data: null, error: null };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            Happy Hour Compass
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Operator Admin Portal</p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Back to dashboard
        </Link>
      </header>

      <div className="max-w-2xl mx-auto p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-1">
          Business Hours
        </h2>
        {venue?.name && (
          <p className="text-sm text-gray-500 mb-6">{venue.name}</p>
        )}

        {/* Operator account error */}
        {operatorError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
            <strong>Cannot edit hours:</strong> {operatorError}
          </div>
        )}

        {/* Venue fetch error */}
        {venueError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-6">
            <strong>Error loading venue:</strong> {venueError.message}
          </div>
        )}

        {/* Venue not found / not owned */}
        {!venueError && !venue && (
          <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-6 text-center">
            <p className="font-medium">Venue not found</p>
            <p className="text-gray-400 text-xs mt-1">
              This venue doesn&rsquo;t exist or you don&rsquo;t have access to
              it.
            </p>
            <Link
              href="/dashboard"
              className="inline-block mt-4 text-sm text-amber-600 hover:text-amber-700 font-medium"
            >
              ← Return to dashboard
            </Link>
          </div>
        )}

        {/* Form — only rendered when all preconditions pass */}
        {!operatorError && operator && venue && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-xs text-gray-400 mb-4">
              Check &ldquo;Closed&rdquo; for days the venue is not open.
              Overnight hours (e.g. 10 PM – 2 AM) are supported.
            </p>
            <BusinessHoursForm
              venueId={id}
              initialHours={(venue.business_hours as BusinessHours) ?? {}}
            />
          </div>
        )}
      </div>
    </main>
  );
}
