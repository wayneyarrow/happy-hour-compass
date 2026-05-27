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
    className="w-3.5 h-3.5 text-gray-300 group-hover:text-amber-500 ml-auto shrink-0 transition-colors"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const ExternalIcon = () => (
  <svg
    className="w-3.5 h-3.5 text-gray-300 group-hover:text-amber-500 ml-auto shrink-0 transition-colors"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

export default function QuickActionsModule({ venueSlug, venueId }: Props) {
  const publicHref = `/venue/${venueSlug ?? venueId}?preview=true`;

  const internalActions: Action[] = [
    { label: "Edit happy hours",    icon: "🍹", href: "/admin/happy-hours?section=times#times" },
    { label: "Update your photos",  icon: "📸", href: "/admin/images" },
    { label: "Manage specials",     icon: "🍽️", href: "/admin/happy-hours?section=food#food" },
    { label: "Manage events",       icon: "🎉", href: "/admin/events" },
    { label: "Update your details", icon: "✏️", href: "/admin/venue" },
  ];

  const externalActions: Action[] = [
    { label: "View public listing", icon: "👁️", href: publicHref, external: true },
  ];

  const rowClass =
    "flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-amber-50/60 border border-transparent hover:border-amber-100 transition-colors group";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Quick Actions</h3>
      </div>

      <div className="space-y-1">
        {internalActions.map(({ label, href, icon }) => (
          <Link key={label} href={href} className={rowClass}>
            <span className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 text-sm" aria-hidden="true">
              {icon}
            </span>
            <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
            <ChevronRight />
          </Link>
        ))}

        <div className="h-px bg-gray-100 my-1.5" />

        {externalActions.map(({ label, href, icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={rowClass}
          >
            <span className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 text-sm" aria-hidden="true">
              {icon}
            </span>
            <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
            <ExternalIcon />
          </a>
        ))}
      </div>
    </div>
  );
}
