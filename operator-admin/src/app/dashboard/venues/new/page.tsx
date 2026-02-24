import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import Link from "next/link";
import VenueForm from "./VenueForm";

// Protected Server Component — resolves auth + operator before rendering form.
// Middleware already guards /dashboard/*, but we double-check here for safety.
export default async function NewVenuePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Resolve operator to confirm the user has a valid operator account before
  // rendering the form. The server action re-resolves this independently on
  // submit — we never trust a client-supplied operator ID.
  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

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
        <h2 className="text-xl font-semibold text-gray-800 mb-6">
          Create a new venue
        </h2>

        {/* Can't proceed without a valid operator row */}
        {operatorError ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4">
            <strong>Cannot create a venue:</strong> {operatorError}
            <p className="mt-2 text-xs text-red-500">
              Return to the{" "}
              <Link href="/dashboard" className="underline">
                dashboard
              </Link>{" "}
              and try again.
            </p>
          </div>
        ) : !operator ? (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-4">
            Operator account not found. Please return to the{" "}
            <Link href="/dashboard" className="underline">
              dashboard
            </Link>{" "}
            and try again.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <VenueForm />
          </div>
        )}
      </div>
    </main>
  );
}
