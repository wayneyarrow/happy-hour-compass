// Per-operator content (venue origin) must be fresh, not cached across operators.
export const dynamic = "force-dynamic";
export const metadata = { title: "Getting Started" };

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getOperatorVenueOrigin } from "@/lib/helpCenter/getOperatorVenueOrigin";
import { getGettingStartedContent } from "@/lib/helpCenter/gettingStartedContent";
import HelpBreadcrumbs from "../components/HelpBreadcrumbs";
import HelpSteps from "../components/HelpSteps";
import HelpSection from "../components/HelpSection";
import HelpInfoSection from "../components/HelpInfoSection";
import HelpNeedSupport from "../components/HelpNeedSupport";
import HelpViewTracker from "../HelpViewTracker";

/**
 * Getting Started guide.
 *
 * Content varies by operator/venue origin (claimed a seeded venue vs. an
 * approved new-venue submission) using venues.source — see
 * src/lib/helpCenter/gettingStartedOrigin.ts for the full reasoning on why
 * that field (and not claimed_at/claimed_by) is the reliable signal.
 *
 * The "Draft" badge is content-driven (`content.isDraft`, defaults to true)
 * rather than hardcoded here — see gettingStartedContent.ts. The claimed-seed
 * variant is now approved, reviewed copy and renders without it; the other
 * two variants are still scaffold-quality placeholder copy and keep it.
 */
export default async function GettingStartedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { origin } = await getOperatorVenueOrigin();
  const content = getGettingStartedContent(origin);
  const title = content.title ?? "Getting Started";
  const isDraft = content.isDraft !== false;

  return (
    <div>
      <HelpViewTracker articleSlug="getting-started" />
      <HelpBreadcrumbs current={title} />

      <div className="max-w-2xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            {isDraft && (
              <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
                Draft
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">{content.intro}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6 mb-6">
          {content.leadSection && <HelpSection section={content.leadSection} />}

          <div className={content.leadSection ? "border-t border-gray-100 pt-5 mt-6" : ""}>
            <HelpSteps steps={content.steps} />
          </div>

          {content.closingSection && (
            <div className="border-t border-gray-100 pt-5 mt-6">
              <HelpSection section={content.closingSection} />
            </div>
          )}

          <HelpInfoSection heading="Good to know" items={content.goodToKnow} />
        </div>

        <HelpNeedSupport />
      </div>
    </div>
  );
}
