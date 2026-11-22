"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MarketFilterSelect from "@/components/MarketFilterSelect";
import { writeMarketFilterParam, type MarketFilterOption, type MarketFilterSelection } from "@/lib/marketFilter";

/**
 * Market dropdown for server-rendered Control Panel lists, which filter on
 * the server from `?market=`. Changing it rewrites only `market` (and drops
 * one-shot params such as `success` and `page`), keeping every other param.
 * When the server rejected an unknown value (`rejected`), the URL is cleaned
 * on mount so it matches the All markets view shown.
 */
export default function UrlMarketFilter({
  options,
  value,
  rejected = false,
  className,
  includeUnassigned = true,
}: {
  options: readonly MarketFilterOption[];
  value: MarketFilterSelection;
  rejected?: boolean;
  className?: string;
  includeUnassigned?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const go = (selection: MarketFilterSelection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("success");
    params.delete("page");
    writeMarketFilterParam(params, selection);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!rejected) return;
    const params = new URLSearchParams(searchParams.toString());
    writeMarketFilterParam(params, value);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    // Clean once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <MarketFilterSelect options={options} value={value} onChange={go} className={className} includeUnassigned={includeUnassigned} />;
}
