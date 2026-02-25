import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";

// Server Component — shows operator account and auth session info.
// This content was previously displayed as prominent cards on the old /dashboard.
export default async function AdminAccountPage() {
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

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Account</h2>
        <p className="text-sm text-gray-500 mt-1">
          Your operator account and session details.
        </p>
      </div>

      {/* Operator error */}
      {operatorError && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 mb-6">
          <strong>Account issue:</strong> {operatorError}
        </div>
      )}

      {/* ── Operator account ─────────────────────────────────────────────── */}
      {operator && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Operator account
          </h3>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-gray-400 w-28 shrink-0">Operator ID</dt>
              <dd className="text-gray-700 font-mono break-all text-xs">
                {operator.id}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 w-28 shrink-0">Email</dt>
              <dd className="text-gray-800">{operator.email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 w-28 shrink-0">Role</dt>
              <dd className="text-gray-800">{operator.role}</dd>
            </div>
            <div className="flex gap-2 items-center">
              <dt className="text-gray-400 w-28 shrink-0">Approval</dt>
              <dd>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    operator.is_approved
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {operator.is_approved ? "Approved" : "Pending"}
                </span>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 w-28 shrink-0">Member since</dt>
              <dd className="text-gray-700 text-xs">
                {new Date(operator.created_at).toLocaleDateString("en-CA", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* ── Auth session ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
          Auth session
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-gray-400 w-28 shrink-0">Auth user ID</dt>
            <dd className="text-gray-700 font-mono break-all text-xs">
              {user.id}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-400 w-28 shrink-0">Email</dt>
            <dd className="text-gray-800">{user.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-400 w-28 shrink-0">Last sign-in</dt>
            <dd className="text-gray-700 text-xs">
              {user.last_sign_in_at
                ? new Date(user.last_sign_in_at).toLocaleString("en-CA")
                : "—"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
