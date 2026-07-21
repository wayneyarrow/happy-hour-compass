import Link from "next/link";

type HhSlot = { start: string; end: string };

// ─── Time helpers ─────────────────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

// Venue happy-hour slot times (from event.venueHhWeekly, built by
// hhParse12hToHHMM in src/lib/data/events.ts) are already normalised to
// 24-hour "HH:MM" — safe to parse with a plain colon split.
function slotToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Event start/end times, by contrast, are stored and passed through as
// human-readable "H:MM AM/PM" strings (e.g. "7:00 PM") — see
// eventFormatters.ts / KnowBeforeYouGo.tsx. Parsing them with slotToMinutes
// silently produced NaN; this parser handles the AM/PM suffix explicitly and
// returns null (rather than NaN) on anything unparseable.
function parseEventTimeToMinutes(time: string): number | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatHhTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${mStr} ${ampm}`;
}

function formatSlotRange(slot: HhSlot): string {
  return `${formatHhTime(slot.start)}–${formatHhTime(slot.end)}`;
}

function getEventDayName(firstDate: string | null): string | null {
  if (!firstDate) return null;
  const m = firstDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return DAY_NAMES[dow];
}

// ─── Window classification ────────────────────────────────────────────────────

type WindowKind = "before" | "after" | "any";

type HhWindow = {
  kind: WindowKind;
  label: string;
  slots: HhSlot[];
};

function classifyWindows(
  daySlots: HhSlot[],
  startTime: string | null,
  endTime: string | null
): HhWindow[] {
  const startMins = startTime ? parseEventTimeToMinutes(startTime) : null;
  const endMins = endTime ? parseEventTimeToMinutes(endTime) : null;

  const before = startMins !== null
    ? daySlots.filter((s) => slotToMinutes(s.end) <= startMins)
    : [];
  const after = endMins !== null
    ? daySlots.filter((s) => slotToMinutes(s.start) >= endMins)
    : [];

  const windows: HhWindow[] = [];
  if (before.length > 0) windows.push({ kind: "before", label: "Before the Event", slots: before });
  if (after.length > 0) windows.push({ kind: "after", label: "After the Event", slots: after });

  if (windows.length === 0 && daySlots.length > 0) {
    windows.push({ kind: "any", label: "Happy Hour", slots: daySlots });
  }

  return windows.slice(0, 2);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WindowCard({
  window: w,
  foodCount,
  drinkCount,
}: {
  window: HhWindow;
  foodCount: number;
  drinkCount: number;
}) {
  const beforeIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 8 14" />
    </svg>
  );
  const afterIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
  const icon = w.kind === "before" ? beforeIcon : afterIcon;

  return (
    <div
      className="flex-1 min-w-0 rounded-xl p-4"
      style={{
        background: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(180,83,9,0.18)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-amber-800">
          {w.label}
        </span>
      </div>

      <div className="space-y-0.5 mb-3">
        {w.slots.map((slot, i) => (
          <p key={i} className="text-[15px] font-bold text-amber-950 leading-snug">
            {formatSlotRange(slot)}
          </p>
        ))}
      </div>

      {(foodCount > 0 || drinkCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {drinkCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-amber-800"
              style={{ background: "rgba(180,83,9,0.10)" }}>
              {/* Wine glass */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
                <path d="M8 22h8" />
                <path d="M12 11v11" />
                <path d="M6 3h12l-3 8a5 5 0 0 1-6 0Z" />
              </svg>
              {drinkCount} drink{drinkCount !== 1 ? "s" : ""}
            </span>
          )}
          {foodCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-amber-800"
              style={{ background: "rgba(180,83,9,0.10)" }}>
              {/* Fork and knife */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
                <path d="M7 2v20" />
                <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
              </svg>
              {foodCount} food{foodCount !== 1 ? " deals" : " deal"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  venueName: string;
  venueUrl: string | null;
  venueHhTagline: string;
  venueHhWeekly: Record<string, Array<{ start: string; end: string }>>;
  venueSpecialsFoodCount: number;
  venueSpecialsDrinksCount: number;
  firstDate: string | null;
  startTime: string | null;
  endTime: string | null;
};

// ─── MakeANightOfIt ───────────────────────────────────────────────────────────

export function MakeANightOfIt({
  venueName,
  venueUrl,
  venueHhTagline,
  venueHhWeekly,
  venueSpecialsFoodCount,
  venueSpecialsDrinksCount,
  firstDate,
  startTime,
  endTime,
}: Props) {
  const hasAnyHh = Object.values(venueHhWeekly).some((slots) => slots.length > 0);
  if (!hasAnyHh) return null;

  const eventDayName = getEventDayName(firstDate);
  const daySlots = eventDayName ? (venueHhWeekly[eventDayName] ?? []) : [];

  // If event day has no HH, pick the next available day's slots as fallback
  const fallbackSlots = daySlots.length === 0
    ? Object.values(venueHhWeekly).find((s) => s.length > 0) ?? []
    : [];

  const effectiveSlots = daySlots.length > 0 ? daySlots : fallbackSlots;
  const windows = classifyWindows(effectiveSlots, startTime, endTime);

  if (windows.length === 0) return null;

  // Context-aware headline based on when HH falls relative to the event.
  const hasBefore = windows.some((w) => w.kind === "before");
  const hasAfter = windows.some((w) => w.kind === "after");
  const hasAny = windows.some((w) => w.kind === "any");

  const contextualTagline = venueHhTagline || (() => {
    if (hasBefore && hasAfter) {
      return "Arrive early for Happy Hour before the event, or stay after the show and keep the night going.";
    }
    if (hasBefore) {
      return "Arrive early and enjoy Happy Hour before the show.";
    }
    if (hasAfter) {
      return "Stick around after the event for Happy Hour.";
    }
    if (hasAny) {
      return "Enjoy Happy Hour during your visit.";
    }
    return "Happy hour is waiting.";
  })();

  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background:
          "linear-gradient(135deg, rgba(254,243,199,0.95) 0%, rgba(253,230,138,0.55) 50%, rgba(252,211,77,0.20) 100%)",
        border: "1px solid rgba(180,83,9,0.20)",
        boxShadow:
          "0 6px 24px rgba(180,83,9,0.12), 0 2px 6px rgba(180,83,9,0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(180,83,9,0.12)", border: "1px solid rgba(180,83,9,0.18)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }} aria-hidden="true">
            <path d="M8 22h8" />
            <path d="M12 11v11" />
            <path d="M6 3h12l-3 8a5 5 0 0 1-6 0Z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-950 leading-snug">
            Happy Hour at {venueName}
          </p>
          <p className="text-sm text-amber-800 mt-0.5 leading-relaxed">
            {contextualTagline}
          </p>
        </div>
      </div>

      {/* HH window cards */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        {windows.map((w, i) => (
          <WindowCard
            key={i}
            window={w}
            foodCount={venueSpecialsFoodCount}
            drinkCount={venueSpecialsDrinksCount}
          />
        ))}
      </div>

      {/* CTA */}
      {venueUrl && (
        <Link
          href={venueUrl}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white text-sm font-semibold transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
        >
          View Full Happy Hour Schedule
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      )}
    </div>
  );
}
