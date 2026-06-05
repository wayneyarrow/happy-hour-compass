export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import { getOperatorMemberships, getMembershipRole, countOperatorMembers } from "@/lib/memberships";
import { maxUsers, parseOperatorPlan } from "@/lib/plans";
import { getOperatorSubscription } from "@/lib/subscriptions";
import UsersClient from "./UsersClient";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await resolveOperatorContext();
  const { operator, operatorError } = ctx;

  // Current user email (works for both normal and impersonation sessions)
  const currentEmail = user.email ?? operator?.email ?? "";

  let memberships    = [] as Awaited<ReturnType<typeof getOperatorMemberships>>;
  let currentRole    = null as Awaited<ReturnType<typeof getMembershipRole>>;
  let totalCount     = 0;
  let userLimit      = 1;
  let plan           = parseOperatorPlan(operator?.plan);

  if (operator) {
    const subscription = await getOperatorSubscription(operator.id);
    plan      = subscription?.plan_code ?? parseOperatorPlan(operator.plan);
    userLimit = maxUsers(plan);

    [memberships, currentRole, totalCount] = await Promise.all([
      getOperatorMemberships(operator.id),
      getMembershipRole(operator.id, currentEmail),
      countOperatorMembers(operator.id),
    ]);
  }

  return (
    <div>
      {operatorError && (
        <div className="max-w-2xl mb-6 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-4">
          <strong>Account error:</strong> {operatorError}
        </div>
      )}

      {operator ? (
        <UsersClient
          operatorId={operator.id}
          currentEmail={currentEmail}
          currentRole={currentRole}
          memberships={memberships}
          plan={plan}
          userLimit={userLimit}
          totalCount={totalCount}
        />
      ) : (
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Users</h2>
          <p className="text-sm text-gray-500 mb-6">
            Manage team members who can access your operator account.
          </p>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center">
            <p className="text-sm text-gray-500">
              Your operator account is not yet set up.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
