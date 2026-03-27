import { ConsumerNav } from "./ConsumerNav";
import { RecoveryRedirect } from "./RecoveryRedirect";

/**
 * Consumer app shell layout.
 *
 * Desktop: replicates the original-app/index.html phone frame presentation —
 *   gray (#f5f5f5) background, centered 375 × 812 px container with rounded
 *   corners and drop shadow.
 *
 * Mobile: full-screen (100dvh × 100vw), no rounding or shadow — looks native
 *   on a real device.
 *
 * Content scrolls inside the shell; ConsumerNav is anchored at the bottom of
 * the flex column rather than fixed to the viewport.
 */
export default function ConsumerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white md:bg-[#f5f5f5] md:flex md:items-center md:justify-center md:p-5">
      {/* Phone frame */}
      <div className="flex flex-col h-dvh w-full md:w-[375px] md:h-[812px] bg-white md:rounded-[30px] md:shadow-[0_10px_30px_rgba(0,0,0,0.3)] overflow-hidden">
        {/* Scrollable content area */}
        {/* overflow-anchor:none — prevents CSS Scroll Anchoring from shifting
            scrollTop when VenueList reorders items via async geolocation sort.
            Without this, restored near-bottom positions are silently adjusted
            by the browser after the geolocation callback fires. */}
        <div id="consumer-scroll" className="flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]">
          <RecoveryRedirect />
          {children}
        </div>
        {/* Bottom nav — sits at the bottom of the shell, not fixed to viewport */}
        <ConsumerNav />
      </div>
    </div>
  );
}
