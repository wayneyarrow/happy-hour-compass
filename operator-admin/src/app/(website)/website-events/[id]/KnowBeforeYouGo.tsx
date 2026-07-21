import { formatPrice } from "./eventFormatters";

// ─── Duration helper ──────────────────────────────────────────────────────────

// start_time / end_time are stored as human-readable "H:MM AM/PM" strings
// (e.g. "7:00 PM") — see eventFormatters.ts. Parse that format explicitly
// rather than assuming 24-hour "HH:MM".
function parseTimeToMinutes(time: string): number | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function deriveDuration(startTime: string | null, endTime: string | null): string | null {
  if (!startTime || !endTime) return null;
  const startMins = parseTimeToMinutes(startTime);
  const endMins = parseTimeToMinutes(endTime);
  if (startMins === null || endMins === null) return null;
  const diffMins = endMins - startMins;
  if (!Number.isFinite(diffMins) || diffMins <= 0) return null;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 mt-0.5 text-gray-400 w-4 h-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.7px] text-gray-400 mb-0.5">
          {label}
        </p>
        <p className="text-sm font-medium text-gray-800 leading-snug">{value}</p>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PriceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function AgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ReservationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ParkingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
    </svg>
  );
}

function AccessibilityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <circle cx="12" cy="7" r="1" />
      <path d="m9 12 1.5 6M15 12l-1.5 6M12 8v4" />
      <path d="M9 13.5a6 6 0 1 0 6 0" />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  priceDisplay: string | null;
  ageRestriction: string | null;
  reservationRecommendation: string | null;
  parkingNotes: string | null;
  accessibilityNotes: string | null;
  startTime: string | null;
  endTime: string | null;
};

// ─── KnowBeforeYouGo ─────────────────────────────────────────────────────────

export function KnowBeforeYouGo({
  priceDisplay,
  ageRestriction,
  reservationRecommendation,
  parkingNotes,
  accessibilityNotes,
  startTime,
  endTime,
}: Props) {
  const duration = deriveDuration(startTime, endTime);

  const items = [
    priceDisplay ? { icon: <PriceIcon />, label: "Price", value: formatPrice(priceDisplay) ?? priceDisplay } : null,
    ageRestriction ? { icon: <AgeIcon />, label: "Age Restriction", value: ageRestriction } : null,
    reservationRecommendation ? { icon: <ReservationIcon />, label: "Reservations", value: reservationRecommendation } : null,
    duration ? { icon: <ClockIcon />, label: "Duration", value: duration } : null,
    parkingNotes ? { icon: <ParkingIcon />, label: "Parking", value: parkingNotes } : null,
    accessibilityNotes ? { icon: <AccessibilityIcon />, label: "Accessibility", value: accessibilityNotes } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5">
      <div className={`grid gap-4 ${items.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
        {items.map((item) => (
          <InfoItem key={item.label} icon={item.icon} label={item.label} value={item.value} />
        ))}
      </div>
    </div>
  );
}
