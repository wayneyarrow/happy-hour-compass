import Link from "next/link";

export default function QuickActionsModule() {
  const actions = [
    { label: "Edit happy hours", href: "/admin/happy-hours", icon: "🍹" },
    { label: "Update venue photos", href: "/admin/images", icon: "📸" },
    { label: "Edit business details", href: "/admin/venue", icon: "✏️" },
    { label: "View public listing", href: "#", icon: "👁️", external: true },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 flex-1">Quick Actions</h3>
      </div>
      <div className="space-y-1.5">
        {actions.map(({ label, href, icon }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors group"
          >
            <span className="text-sm shrink-0" aria-hidden="true">{icon}</span>
            <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
            <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-400 ml-auto shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}
