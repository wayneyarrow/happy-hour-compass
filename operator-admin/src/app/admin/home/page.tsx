export const metadata = { title: "Home" };

import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";

export default async function AdminHomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { operator } = await ensureOperatorForSession(supabase, user);

  const displayName =
    operator?.first_name ||
    operator?.name ||
    operator?.email ||
    "there";

  return (
    <div className="max-w-xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">
        Hi {displayName}
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        A summary dashboard with key metrics and quick links is coming soon.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center">
        <p className="text-sm font-medium text-gray-600">Coming soon</p>
        <p className="text-xs text-gray-400 mt-1">
          Check back here for an overview of your venue performance.
        </p>
      </div>
    </div>
  );
}
