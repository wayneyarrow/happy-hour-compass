"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";

// ── Types ──────────────────────────────────────────────────────────────────────

export type VenueRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  is_published: boolean;
  claimed_at: string | null;
  updated_at: string;      // ISO string
  operatorEmail: string | null;
};

type SortCol     = "name" | "city" | "is_published" | "claimed_at" | "updated_at";
type PubFilter   = "all" | "published" | "draft";
type ClaimFilter = "all" | "claimed" | "unclaimed";

const PAGE_SIZE   = 25;
const DEFAULT_SORT: SortCol = "updated_at";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function readUrlParam(key: string, fallback: string): string {
  const p = new URLSearchParams(window.location.search);
  return p.get(key) ?? fallback;
}

function syncUrl(q: string, pub: string, claimed: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams();
  if (q)              p.set("q",       q);
  if (pub !== "all")  p.set("pub",     pub);
  if (claimed !== "all") p.set("claimed", claimed);
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (dir !== "desc") p.set("dir",     dir);
  if (page > 1)       p.set("page",    String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PublishedBadge({ published }: { published: boolean }) {
  return published ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      Published
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Draft
    </span>
  );
}

function ClaimedBadge({ claimedAt }: { claimedAt: string | null }) {
  return claimedAt ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      Claimed
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
      Unclaimed
    </span>
  );
}

// ── VenuesTable ────────────────────────────────────────────────────────────────

export default function VenuesTable({ rows }: { rows: VenueRow[] }) {
  const router = useRouter();

  const [q,       setQ]       = useState("");
  const [pub,     setPub]     = useState<PubFilter>("all");
  const [claimed, setClaimed] = useState<ClaimFilter>("all");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page,    setPage]    = useState(1);

  // Hydrate state from URL once on mount
  useEffect(() => {
    const q0       = readUrlParam("q",       "");
    const pub0     = readUrlParam("pub",     "all") as PubFilter;
    const claimed0 = readUrlParam("claimed", "all") as ClaimFilter;
    const sort0    = readUrlParam("sort",    DEFAULT_SORT) as SortCol;
    const dir0     = readUrlParam("dir",     "desc") as "asc" | "desc";
    const page0    = Math.max(1, parseInt(readUrlParam("page", "1"), 10));
    setQ(q0);
    setPub(pub0);
    setClaimed(claimed0);
    setSortCol(sort0);
    setSortDir(dir0);
    setPage(page0);
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((v) => {
      if (lq && !v.name.toLowerCase().includes(lq) &&
                !(v.operatorEmail?.toLowerCase().includes(lq))) return false;
      if (pub === "published"  && !v.is_published) return false;
      if (pub === "draft"      &&  v.is_published) return false;
      if (claimed === "claimed"   && !v.claimed_at) return false;
      if (claimed === "unclaimed" &&  v.claimed_at) return false;
      return true;
    });
  }, [rows, q, pub, claimed]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "city":
          if (!a.city && !b.city) cmp = 0;
          else if (!a.city) cmp = 1;
          else if (!b.city) cmp = -1;
          else cmp = a.city.localeCompare(b.city);
          break;
        case "is_published":
          cmp = a.is_published === b.is_published ? 0 : a.is_published ? -1 : 1;
          break;
        case "claimed_at":
          if (!a.claimed_at && !b.claimed_at) cmp = 0;
          else if (!a.claimed_at) cmp = 1;
          else if (!b.claimed_at) cmp = -1;
          else cmp = a.claimed_at.localeCompare(b.claimed_at);
          break;
        case "updated_at":
          cmp = a.updated_at.localeCompare(b.updated_at);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── State update helpers ──────────────────────────────────────────────────

  const applySort = (col: SortCol) => {
    const newDir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    const newCol = col;
    setSortCol(newCol);
    setSortDir(newDir);
    setPage(1);
    syncUrl(q, pub, claimed, newCol, newDir, 1);
  };

  const applySearch = (val: string) => {
    setQ(val);
    setPage(1);
    syncUrl(val, pub, claimed, sortCol, sortDir, 1);
  };

  const applyPub = (val: PubFilter) => {
    setPub(val);
    setPage(1);
    syncUrl(q, val, claimed, sortCol, sortDir, 1);
  };

  const applyClaimed = (val: ClaimFilter) => {
    setClaimed(val);
    setPage(1);
    syncUrl(q, pub, val, sortCol, sortDir, 1);
  };

  const applyPage = (p: number) => {
    setPage(p);
    syncUrl(q, pub, claimed, sortCol, sortDir, p);
  };

  // ── Shared styles ─────────────────────────────────────────────────────────

  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400";

  const thBtnCls =
    "group inline-flex items-center text-xs font-semibold text-gray-500 " +
    "uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";

  const thStaticCls =
    "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => applySearch(e.target.value)}
          placeholder="Search venues or operator…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <select
          value={pub}
          onChange={(e) => applyPub(e.target.value as PubFilter)}
          className={selectCls}
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <select
          value={claimed}
          onChange={(e) => applyClaimed(e.target.value as ClaimFilter)}
          className={selectCls}
        >
          <option value="all">All claim states</option>
          <option value="claimed">Claimed</option>
          <option value="unclaimed">Unclaimed</option>
        </select>
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No venues match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-slate-50">
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("name")} className={thBtnCls}>
                        Venue <SortIcon active={sortCol === "name"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("city")} className={thBtnCls}>
                        City <SortIcon active={sortCol === "city"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("is_published")} className={thBtnCls}>
                        Published <SortIcon active={sortCol === "is_published"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("claimed_at")} className={thBtnCls}>
                        Claimed <SortIcon active={sortCol === "claimed_at"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <span className={thStaticCls}>Operator</span>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("updated_at")} className={thBtnCls}>
                        Updated <SortIcon active={sortCol === "updated_at"} dir={sortDir} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((v) => (
                    <tr
                      key={v.id}
                      onClick={() => router.push(`/control-panel/venues/${v.id}`)}
                      className="hover:bg-amber-50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">{v.name}</span>
                        <div className="text-xs text-gray-400 mt-0.5 font-mono">{v.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {v.city ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <PublishedBadge published={v.is_published} />
                      </td>
                      <td className="px-4 py-3">
                        <ClaimedBadge claimedAt={v.claimed_at} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {v.operatorEmail ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {fmtDate(v.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={applyPage} />
        </>
      )}
    </div>
  );
}
