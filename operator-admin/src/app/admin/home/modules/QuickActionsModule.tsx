import Link from "next/link";

type Action = {
  label: string;
  icon: string;
  href: string;
  external?: boolean;
};

type Props = {
  venueSlug: string | null;
  venueId: string;
};

const ChevronRight = () => (
  <svg
    className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-400 ml-auto shrink-0 transition-colors"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

export default function QuickActionsModule({ venueSlug, venueId }: Props) {
  const publicHref = `/venue/${venueSlug ?? venueId}?preview=true`;

  const QUICK_ACTIONS: Action[] = [
    { label: "Edit happy hours",      icon: "🍹", href: "/admin/happy-hours?section=times#times" },
    { label: "Update your photos",    icon: "📸", href: "/admin/images" },
    { label: "Manage specials",       icon: "🍽️", href: "/admin/happy-hours?section=food#food" },
    { label: "Manage events",         icon: "🎉", href: "/admin/events" },
    { label: "Update your details",   icon: "✏️", href: "/admin/venue" },
    { label: "View public listing",   icon: "👁️", href: publicHref, external: true },
  ];

  const rowClass =
    "flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors group";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Quick Actions</h3>
      </div>

      <div className="space-y-1">
        {QUICK_ACTIONS.map(({ label, href, icon, external }) =>
          external ? (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={rowClass}
            >
              <span className="text-sm shrink-0" aria-hidden="true">{icon}</span>
              <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
              <ChevronRight />
            </a>
          ) : (
            <Link key={label} href={href} className={rowClass}>
              <span className="text-sm shrink-0" aria-hidden="true">{icon}</span>
              <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
              <ChevronRight />
            </Link>
          )
        )}
      </div>
    </div>
  );
}
