const STAR_PATH =
  "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

/** Returns a fill fraction (0, 0.5, or 1) for each of the 5 star positions. */
function starFractions(rating: number): number[] {
  return Array.from({ length: 5 }, (_, i) => {
    const diff = rating - i;
    if (diff >= 0.7) return 1;
    if (diff >= 0.3) return 0.5;
    return 0;
  });
}

function StarIcon({ fraction }: { fraction: number }) {
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: 13, height: 13 }}
      aria-hidden="true"
    >
      {/* Gray background */}
      <svg className="absolute inset-0" width="13" height="13" viewBox="0 0 24 24">
        <path d={STAR_PATH} fill="#d1d5db" />
      </svg>
      {/* Amber fill, clipped by fraction width */}
      {fraction > 0 && (
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${fraction * 100}%` }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24">
            <path d={STAR_PATH} fill="#f59e0b" />
          </svg>
        </span>
      )}
    </span>
  );
}

type Props = {
  googleRating: number | null;
  googleReviewCount: number | null;
};

/**
 * Displays the Google rating below the venue meta row.
 * Renders nothing when googleRating is absent.
 */
export function GoogleRatingBadge({ googleRating, googleReviewCount }: Props) {
  if (googleRating === null) return null;

  const fractions = starFractions(googleRating);
  const ratingDisplay = googleRating % 1 === 0
    ? googleRating.toFixed(1)
    : String(googleRating);
  const countDisplay =
    googleReviewCount !== null
      ? `(${googleReviewCount.toLocaleString("en-US")})`
      : null;

  return (
    <div className="flex items-center gap-1.5 mt-2.5" aria-label={`Google rating: ${ratingDisplay} out of 5`}>
      {/* Stars */}
      <span className="flex items-center gap-[2px]">
        {fractions.map((f, i) => (
          <StarIcon key={i} fraction={f} />
        ))}
      </span>
      {/* Numeric rating */}
      <span className="text-[12px] font-medium text-gray-700 leading-none">
        {ratingDisplay}
      </span>
      {/* Review count */}
      {countDisplay && (
        <span className="text-[11px] text-gray-500 leading-none">
          {countDisplay}
        </span>
      )}
      {/* Attribution separator */}
      <span className="text-[11px] text-gray-400 leading-none" aria-hidden="true">·</span>
      {/* Google attribution */}
      <span className="text-[11px] text-gray-500 leading-none">via Google</span>
    </div>
  );
}
