import Link from "next/link";

// Kept in the same order as ControlPanelSideNav.tsx's NAV_ITEMS (source of
// truth for what's implemented), minus "Dashboard" itself. Industry Reads is
// appended at the end — it's a real, implemented route but isn't in the
// persistent side nav, so this card is currently its only entry point.
const SECTIONS: Array<{
  title: string;
  href: string;
  description: string;
  status: "active" | "soon";
}> = [
  {
    title: "Analytics",
    href: "/control-panel/analytics",
    description: "Platform-wide metrics — acquisition, activation, monetization, and consumer demand.",
    status: "active" as const,
  },
  {
    title: "Action Center",
    href: "/control-panel/action-center",
    description: "Operational work queues for HHC staff. Each report answers: what should we do next?",
    status: "active" as const,
  },
  {
    title: "Claims",
    href: "/control-panel/claims",
    description: "Review venue ownership claims submitted by operators. Approve, reject, or request more information.",
    status: "active" as const,
  },
  {
    title: "Operator Submissions",
    href: "/control-panel/operator-submissions",
    description: "Triage pre-auth operator submissions. Review Google match outcomes, trust signals, and linked venues.",
    status: "active" as const,
  },
  {
    title: "Venues",
    href: "/control-panel/venues",
    description: "Browse all venues on the platform — published status, claim state, and linked operator.",
    status: "active" as const,
  },
  {
    title: "Operators",
    href: "/control-panel/operators",
    description: "View operator accounts, approval status, and linked venues.",
    status: "active" as const,
  },
  {
    title: "Discover Management",
    href: "/control-panel/discover",
    description: "Manage Consumer Home discovery rails. Preview each rail, adjust internal boost, toggle spotlight eligibility, and add or remove venues via internal curation.",
    status: "active" as const,
  },
  {
    title: "Content Engine",
    href: "/control-panel/content-engine",
    description: "Create and manage the Venue Guides and Event Guides platform admins publish across the Happy Hour Compass website.",
    status: "active" as const,
  },
  {
    title: "FAQ Library",
    href: "/control-panel/content-engine/faq-library",
    description: "Reusable questions guides can answer from — the shared library used across the guide editor.",
    status: "active" as const,
  },
  {
    title: "Collections",
    href: "/control-panel/collections",
    description: "Reusable editorial curation — Venue, Event, and Guide Collections that Homepage Sections assemble into the public website.",
    status: "active" as const,
  },
  {
    title: "Homepages",
    href: "/control-panel/homepages",
    description: "One Homepage per geographic destination — a Market or a City within a Market. Homepages assemble published Collections via Sections.",
    status: "active" as const,
  },
  {
    title: "Venue QA",
    href: "/control-panel/settings",
    description: "Tools for reviewing and publishing imported venue data before it goes live.",
    status: "active" as const,
  },
  {
    title: "Integrations",
    href: "/control-panel/integrations",
    description: "Manage third-party service connections and test notification delivery.",
    status: "active" as const,
  },
  {
    title: "Platform Admins",
    href: "/control-panel/platform-admins",
    description: "Manage who has access to this Control Panel. All platform admins have full access.",
    status: "active" as const,
  },
  {
    title: "Audit Logs",
    href: "/control-panel/audit-logs",
    description: "High-value platform actions — who did it, what, and when.",
    status: "active" as const,
  },
  {
    title: "Industry Reads",
    href: "/control-panel/industry-reads",
    description: "Review and rate article relevance to tune keyword weighting and source quality over time.",
    status: "active" as const,
  },
];

export default function ControlPanelDashboard() {
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Admin Control Panel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Internal platform management. Use the sections below to manage venues, operators, and claims.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECTIONS.map(({ title, href, description, status }) => (
          <Link
            key={href}
            href={href}
            className="bg-white rounded-xl border border-gray-200 shadow-resting p-6 hover:border-amber-300 hover:shadow-hover transition-all group"
          >
            <div className="flex items-start justify-between mb-2">
              <h2 className="text-base font-semibold text-slate-900 group-hover:text-amber-600 transition-colors">
                {title}
              </h2>
              {status === "soon" && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 ml-2 shrink-0">
                  Coming soon
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
