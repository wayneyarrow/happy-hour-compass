// Per-operator content (venue origin) must be fresh, not cached across operators.
export const dynamic = "force-dynamic";
export const metadata = { title: "Getting Started" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getOperatorVenueOrigin } from "@/lib/helpCenter/getOperatorVenueOrigin";
import { getGettingStartedContent } from "@/lib/helpCenter/gettingStartedContent";
import HelpBreadcrumbs from "../components/HelpBreadcrumbs";
import HelpSteps from "../components/HelpSteps";
import HelpInfoSection from "../components/HelpInfoSection";
import HelpNeedSupport from "../components/HelpNeedSupport";

/**
 * Getting Started guide.
 *
 * Content varies by operator/venue origin (claimed a seeded venue vs. an
 * approved new-venue submission) using venues.source — see
 * src/lib/helpCenter/gettingStartedOrigin.ts for the full reasoning on why
 * that field (and not claimed_at/claimed_by) is the reliable signal.
 *
 * The "Draft" badge below is intentional: per the task brief this is the
 * reusable structure only, not the final reviewed Getting Started copy.
 */
export default async function GettingStartedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { origin } = await getOperatorVenueOrigin();
  const content = getGettingStartedContent(origin);

  return (
    <div>
      <HelpBreadcrumbs current="Getting Started" />

      <div className="max-w-2xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">Getting Started</h1>
            <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
              Draft
            </span>
          </div>
          <p className="text-sm text-gray-500">{content.intro}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6 mb-6">
          <HelpSteps steps={content.steps} />
          <HelpInfoSection heading="Good to know" items={content.goodToKnow} />
        </div>

        <HelpNeedSupport />
      </div>
    </div>
  );
}
