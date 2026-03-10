import Link from "next/link";

const SECTIONS = [
  {
    title: "Claims",
    href: "/control-panel/claims",
    description: "Review venue ownership claims submitted by operators. Approve, reject, or request more information.",
    status: "active" as const,
  },
  {
    title: "Venues",
    href: "/control-panel/venues",
    description: "Browse and manage all venues on the platform.",
    status: "soon" as const,
  },
  {
    title: "Operators",
    href: "/control-panel/operators",
    description: "View operator accounts, approval status, and activity.",
    status: "soon" as const,
  },
  {
    title: "Settings",
    href: "/control-panel/settings",
    description: "Platform configuration and feature flags.",
    status: "soon" as const,
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
            className="bg-white rounded-xl border border-gray-200 p-6 hover:border-amber-300 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between mb-2">
              <h2 className="text-base font-semibold text-slate-900 group-hover:text-amber-700 transition-colors">
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
