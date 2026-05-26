import Link from "next/link";

type Metric = {
  label: string;
  icon: string;
  value: number;
  href: string;
};

type Props = {
  /** Total images on the venue listing (operator-uploaded + any seeded). */
  photosCount: number;
  /** Combined food + drink special item count. */
  specialsCount: number;
  /** Total event row count for this venue. */
  eventsCount: number;
};

export default function VenueSnapshotModule({ photosCount, specialsCount, eventsCount }: Props) {
  const metrics: Metric[] = [
    { label: "Photos",   icon: "📷", value: photosCount,   href: "/admin/images" },
    { label: "Specials", icon: "🍽️", value: specialsCount, href: "/admin/happy-hours" },
    { label: "Events",   icon: "🎉", value: eventsCount,   href: "/admin/events" },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 md:col-span-2">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4 text-purple-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Venue Snapshot</h3>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-3 gap-3">
        {metrics.map(({ label, icon, value, href }) => (
          <Link
            key={label}
            href={href}
            className="group flex flex-col items-center text-center p-4 bg-gray-50 rounded-xl border border-gray-100 hover:bg-white hover:border-gray-200 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-1.5 mb-2.5">
              <span className="text-base leading-none" aria-hidden="true">{icon}</span>
              <span className="text-xs font-medium text-gray-500 group-hover:text-gray-700 transition-colors">
                {label}
              </span>
            </div>
            <span
              className={`text-2xl font-bold tabular-nums leading-none ${
                value === 0 ? "text-gray-300" : "text-gray-900"
              }`}
            >
              {value}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
