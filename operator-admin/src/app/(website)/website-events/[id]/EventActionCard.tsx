import Link from "next/link";
import { formatPrice } from "./eventFormatters";

type Props = {
  /** Pre-formatted label from buildDetailDateLabel, e.g. "Tuesdays • 8:00 PM" */
  detailDateLabel: string;
  priceDisplay: string | null;
  venueName: string;
  venueUrl: string | null;
  mapsUrl: string | null;
  websiteUrl: string | null;
  phone: string;
  ticketingEnabled: boolean;
  ticketUrl: string | null;
  soldOut: boolean;
  isExpired: boolean;
};

// ─── Shared icon SVG paths ────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 0 0-2 2v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5z" />
    </svg>
  );
}

function DirectionsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.11 8 19.79 19.79 0 0 1 1.04 4.11a2 2 0 0 1 1.72-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({
  href,
  label,
  icon,
  subtle = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  subtle?: boolean;
}) {
  const isExternal = href.startsWith("http");
  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className={`flex items-center gap-2.5 w-full px-4 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 ${
        subtle
          ? "py-2.5 text-gray-700 bg-gray-50 hover:bg-gray-100"
          : "py-3.5 text-white bg-amber-500 hover:bg-amber-600"
      }`}
    >
      {icon}
      {label}
    </a>
  );
}

function SoldOutBtn() {
  return (
    <div className="flex items-center gap-2.5 w-full px-4 py-3.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-400 cursor-not-allowed select-none">
      <TicketIcon />
      Sold Out
    </div>
  );
}

// ─── EventActionCard ──────────────────────────────────────────────────────────

export function EventActionCard({
  detailDateLabel,
  priceDisplay,
  venueName,
  venueUrl,
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
  const hasSecondary = Boolean(mapsUrl || websiteUrl || phone);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">

      {/* Schedule header */}
      <div className="px-5 pt-5 pb-4 bg-gradient-to-br from-amber-50 to-orange-50/50 border-b border-amber-100/80">
        <div className="flex items-start gap-2 mb-2">
          <span className="text-amber-600 mt-0.5">
            <CalendarIcon />
          </span>
          <p className="text-sm font-bold text-amber-900 leading-snug">
            {isExpired ? "This event has passed" : (detailDateLabel || "See venue for schedule")}
          </p>
        </div>
        {venueUrl ? (
          <Link
            href={venueUrl}
            className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
          >
            {venueName}
          </Link>
        ) : (
          <p className="text-xs text-gray-500">{venueName}</p>
        )}
        {priceDisplay && (
          <p className="text-xs text-gray-500 mt-1.5 font-medium">{formatPrice(priceDisplay)}</p>
        )}
      </div>

      {/* Actions */}
      {(hasTicketCTA || hasSecondary) && (
        <div className="px-4 pt-4 pb-4 space-y-2">
          {/* Primary: Get Tickets */}
          {showGetTickets && (
            <ActionBtn
              href={ticketUrl!}
              label="Get Tickets"
              icon={<TicketIcon />}
            />
          )}

          {/* Sold out state */}
          {showSoldOut && <SoldOutBtn />}

          {/* Divider between primary and secondary */}
          {hasTicketCTA && hasSecondary && (
            <div className="border-t border-gray-100 !mt-3 !mb-1" />
          )}

          {/* Directions */}
          {mapsUrl && (
            <ActionBtn
              href={mapsUrl}
              label="Get Directions"
              icon={<DirectionsIcon />}
              subtle={hasTicketCTA}
            />
          )}

          {/* Venue website */}
          {websiteUrl && (
            <ActionBtn
              href={websiteUrl}
              label="Visit Website"
              icon={<GlobeIcon />}
              subtle
            />
          )}

          {/* Call */}
          {phone && (
            <ActionBtn
              href={`tel:${phone}`}
              label="Call Venue"
              icon={<PhoneIcon />}
              subtle
            />
          )}
        </div>
      )}
    </div>
  );
}
