"use client";

import { trackEvent } from "@/lib/analytics";

type Props = {
  venueId: string;
  city: string;
  address: string;
  mapsUrl: string | null;
  menuTarget: string | null;
  phone: string;
  websiteUrl: string;
  paymentMethods: string;
};

const ROW_CLASS =
  "flex items-start justify-between py-[18px] min-h-[60px] border-b border-gray-100 " +
  "hover:bg-gray-50 active:bg-gray-100 transition-colors -mx-5 px-5";

const LABEL_CLASS =
  "text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5";

const VALUE_CLASS = "text-[15px] text-gray-900 leading-[1.5]";

function ExternalLinkIcon() {
  return (
    <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </div>
  );
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function VenueInfoRows({
  venueId,
  city,
  address,
  mapsUrl,
  menuTarget,
  phone,
  websiteUrl,
  paymentMethods,
}: Props) {
  return (
    <>
      {address && (
        <a
          href={mapsUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={ROW_CLASS}
          onClick={() => trackEvent("venue_directions_clicked", { venue_id: venueId, city })}
        >
          <div className="flex-1 min-w-0">
            <p className={LABEL_CLASS}>Address</p>
            <p className={`${VALUE_CLASS} line-clamp-2 break-words`}>{address}</p>
          </div>
          <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
        </a>
      )}

      {menuTarget && (
        <a
          href={menuTarget}
          target="_blank"
          rel="noopener noreferrer"
          className={ROW_CLASS}
        >
          <div className="flex-1 min-w-0">
            <p className={LABEL_CLASS}>Menu</p>
            <p className={VALUE_CLASS}>View menu</p>
          </div>
          <ExternalLinkIcon />
        </a>
      )}

      {phone && (
        <a
          href={`tel:${phone}`}
          className={ROW_CLASS}
          onClick={() => trackEvent("venue_phone_clicked", { venue_id: venueId, city })}
        >
          <div className="flex-1 min-w-0">
            <p className={LABEL_CLASS}>Phone</p>
            <p className={VALUE_CLASS}>{formatPhone(phone)}</p>
          </div>
          <div className="flex items-center ml-3 mt-0.5 shrink-0 text-gray-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </div>
        </a>
      )}

      {paymentMethods && (
        <div className="flex items-start justify-between py-4 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <p className={LABEL_CLASS}>Payment</p>
            <p className={`${VALUE_CLASS} break-words`}>{paymentMethods}</p>
          </div>
        </div>
      )}

      {websiteUrl && (
        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={ROW_CLASS}
          onClick={() => trackEvent("venue_website_clicked", { venue_id: venueId, city })}
        >
          <div className="flex-1 min-w-0">
            <p className={LABEL_CLASS}>Website</p>
            <p className={`${VALUE_CLASS} truncate`}>{websiteUrl.replace(/^https?:\/\//, "")}</p>
          </div>
          <ExternalLinkIcon />
        </a>
      )}
    </>
  );
}
