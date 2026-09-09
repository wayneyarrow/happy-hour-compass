"use client";

/**
 * Shared visible text-search field for the discovery results pages —
 * Happy Hours (website-happy-hours/HappyHoursSearchClient.tsx) and Events
 * (website-events/EventSearchResults.tsx) both render this. Extracted from
 * HappyHoursSearchClient.tsx's own (until now file-local) VenueSearchInput
 * — same pill visual language as the homepage's HeroDiscoverySearch
 * (border, rounded-full, shadow, amber focus ring, search icon), so all
 * three discovery pages read as one consistent search treatment rather
 * than three separate ones. Happy Hours' own usage is unchanged in every
 * visible respect — this refactor only moves where the markup lives.
 *
 * Daily Specials' results page (DailySpecialSearchResults.tsx) uses a
 * simpler, un-bordered-icon pill for its own search field and is left as
 * it is — not every discovery page needs identical markup, only a
 * consistent, understandable text-search treatment (per this task's
 * Consistency guidance).
 */
export function DiscoverySearchInput({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <div
      className="
        flex items-center gap-2.5 pl-4 pr-3 py-2.5
        bg-white border border-gray-200 rounded-full
        shadow-[0_1px_2px_rgba(0,0,0,0.04)]
        focus-within:ring-2 focus-within:ring-amber-400
        transition-all
      "
    >
      <svg
        className="w-4 h-4 text-gray-400 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        className="flex-1 min-w-0 text-sm text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="flex-shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
