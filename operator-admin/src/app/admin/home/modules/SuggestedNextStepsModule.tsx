import Link from "next/link";
import type { SuggestionCard } from "@/lib/suggestedSteps";

type Props = {
  suggestions: SuggestionCard[];
};

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <span className="text-3xl mb-3" aria-hidden="true">✨</span>
      <p className="text-sm font-medium text-gray-700">Your listing is in great shape.</p>
      <p className="text-xs text-gray-400 mt-1 leading-relaxed">
        We&apos;ll surface new opportunities as your venue grows.
      </p>
    </div>
  );
}

// ── Suggestion card ───────────────────────────────────────────────────────────
// The first suggestion (isPrimary) is visually elevated to signal it's the
// highest-impact action. Subsequent cards use a quieter treatment.

function Card({ card, isPrimary = false }: { card: SuggestionCard; isPrimary?: boolean }) {
  return (
    <div
      className={`flex flex-col gap-2 p-4 rounded-xl border transition-colors ${
        isPrimary
          ? "border-amber-200 bg-white shadow-sm hover:shadow hover:border-amber-300"
          : "border-gray-100 bg-gray-50 hover:border-amber-100 hover:bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`leading-none ${isPrimary ? "text-2xl" : "text-xl"}`}
          aria-hidden="true"
        >
          {card.icon}
        </span>
        {isPrimary && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5 shrink-0">
            Top pick
          </span>
        )}
      </div>
      <div className="flex-1">
        <p
          className={`font-semibold leading-snug ${
            isPrimary ? "text-sm text-gray-900" : "text-xs text-gray-800"
          }`}
        >
          {card.title}
        </p>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{card.description}</p>
      </div>
      <Link
        href={card.href}
        className="mt-1 self-start text-xs font-semibold text-amber-700 hover:text-amber-800 transition-colors"
      >
        {card.ctaLabel} →
      </Link>
    </div>
  );
}

// ── Module ────────────────────────────────────────────────────────────────────

export default function SuggestedNextStepsModule({ suggestions }: Props) {
  const colClass =
    suggestions.length >= 3
      ? "grid-cols-1 sm:grid-cols-3"
      : suggestions.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1";

  return (
    <div className="bg-gradient-to-b from-white to-amber-50/30 rounded-xl border border-amber-100 p-5 md:col-span-2">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 flex-1">Suggested Next Steps</h3>
        {suggestions.length > 0 && (
          <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
            {suggestions.length} suggestion{suggestions.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* CSM intro — only shown when there are suggestions */}
      {suggestions.length > 0 && (
        <p className="text-xs text-gray-500 mb-4 ml-11 leading-relaxed">
          Based on your listing, here&apos;s what would have the most impact right now.
        </p>
      )}

      {/* Cards or empty state */}
      {suggestions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className={`grid gap-3 ${colClass}`}>
          {suggestions.map((card, i) => (
            <Card key={card.id} card={card} isPrimary={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
