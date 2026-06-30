type Props = {
  mapsUrl: string | null;
  websiteUrl: string | null;
  phone: string;
  ticketingEnabled: boolean;
  ticketUrl: string | null;
  soldOut: boolean;
  isExpired: boolean;
};

export function EventMobileActionBar({
  mapsUrl,
  websiteUrl,
  phone,
  ticketingEnabled,
  ticketUrl,
  soldOut,
  isExpired,
}: Props) {
  const showGetTickets =
    ticketingEnabled && !soldOut && Boolean(ticketUrl) && !isExpired;
  const showSoldOut = ticketingEnabled && soldOut;
  const hasTicketCTA = showGetTickets || showSoldOut;

  // Secondary icon-only actions shown beside the ticket CTA (or as the main row
  // when there's no ticket CTA at all).
  const secondaryActions = [
    ...(mapsUrl
      ? [
          {
            href: mapsUrl,
            label: "Directions",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 8 19.79 19.79 0 0 1 1.04 4.11a2 2 0 0 1 1.72-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  // Nothing to show — render nothing.
  if (!hasTicketCTA && secondaryActions.length === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {hasTicketCTA ? (
        // Hybrid layout: prominent CTA + icon tabs beside it
        <div className="flex items-center gap-2 px-4 py-2.5">
          {showGetTickets && (
            <a
              href={ticketUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
                <path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 0 0-2 2v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5z" />
              </svg>
              Get Tickets
            </a>
          )}
          {showSoldOut && (
            <div className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-100 text-gray-400 text-sm font-semibold rounded-xl cursor-not-allowed select-none">
              Sold Out
            </div>
          )}
          {secondaryActions.map((action) => (
            <a
              key={action.href}
              href={action.href}
              target={action.href.startsWith("http") ? "_blank" : undefined}
              rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors active:bg-amber-100"
            >
              {action.icon}
              <span className="text-[10px] font-semibold tracking-wide">{action.label}</span>
            </a>
          ))}
        </div>
      ) : (
        // No ticket CTA — full-width icon tab row (mirrors VenueMobileActionBar)
        <div className="flex divide-x divide-gray-100">
          {secondaryActions.map((action) => (
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
      )}
    </div>
  );
}
