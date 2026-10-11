import Link from "next/link";
import type { ReactNode } from "react";
import { formatRate } from "@/lib/searchDiscoveryReporting/config";

/**
 * Presentational pieces for the Search & Discovery report — same visual
 * language as Platform Analytics (control-panel/analytics/page.tsx): white
 * rounded cards, slate headings, gray secondary text. Server Components; the
 * controls are plain links so the report needs no client JavaScript.
 */

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-CA"));
export { formatRate };

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-raised p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{label}</p>
      <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
    </div>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const cls = tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-slate-50 border-slate-200 text-slate-700";
  return <div className={`rounded-lg border px-4 py-3 text-xs leading-relaxed ${cls}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {children && <p className="mt-1 text-xs text-gray-400 max-w-md mx-auto">{children}</p>}
    </div>
  );
}

export type Col<T> = { key: string; label: ReactNode; render: (row: T) => ReactNode; align?: "left" | "right"; title?: string };

export function Table<T>({ cols, rows, rowKey, caption }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; caption?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="min-w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            {cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                title={c.title}
                className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-gray-50/50">
              {cols.map((c, i) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 text-gray-700 ${c.align === "right" ? "text-right tabular-nums whitespace-nowrap" : ""} ${i === 0 ? "min-w-[11rem]" : ""}`}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pills({ label, options }: { label: string; options: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mr-1">{label}</span>
      {options.map((o) => (
        <Link
          key={o.label}
          href={o.href}
          aria-current={o.active ? "true" : undefined}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            o.active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "amber" | "blue" }) {
  const cls = tone === "amber" ? "bg-amber-50 text-amber-700" : tone === "blue" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{children}</span>;
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
      <p className="font-semibold">Report not shown — the data couldn&apos;t be loaded completely.</p>
      <p className="mt-1 text-xs">{message}</p>
    </div>
  );
}

/** Tiny horizontal bar list for daily buckets. */
export function DailyBars({ days }: { days: { day: string; value: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
      {days.map((d) => (
        <div key={d.day} className="flex items-center gap-3 text-xs">
          <span className="w-20 shrink-0 text-gray-500 tabular-nums">{d.day}</span>
          <div className="flex-1 h-2 rounded bg-gray-100">
            <div className="h-2 rounded bg-slate-700" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="w-10 text-right tabular-nums text-gray-700">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Shared tab strip: Platform Analytics ↔ Search & Discovery. */
export function AnalyticsTabs({ active }: { active: "platform" | "search-discovery" }) {
  const tabs = [
    { key: "platform", label: "Platform Analytics", href: "/control-panel/analytics" },
    { key: "search-discovery", label: "Search & Discovery", href: "/control-panel/analytics/search-discovery" },
  ] as const;
  return (
    <nav aria-label="Analytics views" className="mb-6 flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${
            t.key === active ? "border-slate-900 text-slate-900" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
