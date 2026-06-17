"use client";

import { trackEvent } from "@/lib/analytics";
import { getSessionId } from "@/lib/trackingSession";

type Props = {
  venueId: string;
  venuePhone: string;
  venueWebsiteUrl: string;
};

/** Call and Website action buttons on the event detail page. */
export function EventActionButtons({ venueId, venuePhone, venueWebsiteUrl }: Props) {
  if (!venuePhone && !venueWebsiteUrl) return null;

  function trackWebsite() {
    trackEvent("venue_website_clicked", { venue_id: venueId });
    fetch("/api/track/venue-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId, clickType: "website", sessionId: getSessionId() }),
    }).catch(() => {});
  }

  return (
    <div className="flex gap-2 px-5 pb-5">
      {venuePhone && (
        <a
          href={`tel:${venuePhone}`}
          className="flex-1 flex flex-col items-center justify-center gap-1.5 bg-white border border-gray-300 rounded-lg text-[13px] font-medium text-[#374151] hover:bg-gray-50 hover:border-gray-400 transition-colors"
          style={{ padding: "12px 8px", minHeight: 64 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>Call</span>
        </a>
      )}
      {venueWebsiteUrl && (
        <a
          href={venueWebsiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={trackWebsite}
          className="flex-1 flex flex-col items-center justify-center gap-1.5 bg-white border border-gray-300 rounded-lg text-[13px] font-medium text-[#374151] hover:bg-gray-50 hover:border-gray-400 transition-colors"
          style={{ padding: "12px 8px", minHeight: 64 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span>Website</span>
        </a>
      )}
    </div>
  );
}
