"use client";

type Props = {
  phone: string;
  mapsUrl: string | null;
  menuUrl: string | null;
  websiteUrl: string;
};

type ActionItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

export function MobileActionBar({ phone, mapsUrl, menuUrl, websiteUrl }: Props) {
  const actions: ActionItem[] = [
    ...(mapsUrl
      ? [
          {
            href: mapsUrl,
            label: "Directions",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            ),
          },
        ]
      : []),
    ...(menuUrl
      ? [
          {
            href: menuUrl,
            label: "Menu",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" ry="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
              </svg>
            ),
          },
        ]
      : []),
    ...(websiteUrl
      ? [
          {
            href: websiteUrl,
            label: "Website",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            ),
          },
        ]
      : []),
    ...(phone
      ? [
          {
            href: `tel:${phone}`,
            label: "Call",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 8 19.79 19.79 0 0 1 1.04 4.11a2 2 0 0 1 1.72-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  if (actions.length === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex divide-x divide-gray-100">
        {actions.map((action) => (
          <a
            key={action.href}
            href={action.href}
            target={action.href.startsWith("http") ? "_blank" : undefined}
            rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
            className="flex-1 flex flex-col items-center gap-1 py-3 text-gray-700 hover:text-amber-600 hover:bg-amber-50 transition-colors active:bg-amber-100"
          >
            {action.icon}
            <span className="text-[10px] font-semibold tracking-wide">{action.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
