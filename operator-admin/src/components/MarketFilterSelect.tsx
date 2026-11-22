"use client";

import {
  MARKET_FILTER_ALL,
  MARKET_FILTER_UNASSIGNED,
  marketFilterOptionLabel,
  type MarketFilterOption,
  type MarketFilterSelection,
} from "@/lib/marketFilter";

/**
 * Control Panel Market dropdown: All markets, every configured market (DB
 * order and names, coming-soon labelled), then Unassigned. Purely
 * presentational — the owning table holds the selection and URL state.
 */
export default function MarketFilterSelect({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly MarketFilterOption[];
  value: MarketFilterSelection;
  onChange: (value: MarketFilterSelection) => void;
  className?: string;
}) {
  return (
    <select
      aria-label="Market"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      <option value={MARKET_FILTER_ALL}>All markets</option>
      {options.map((o) => (
        <option key={o.id} value={o.slug}>
          {marketFilterOptionLabel(o)}
        </option>
      ))}
      <option value={MARKET_FILTER_UNASSIGNED}>Unassigned</option>
    </select>
  );
}
