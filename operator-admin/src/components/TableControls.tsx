"use client";

// ── SortIcon ──────────────────────────────────────────────────────────────────

export function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: "asc" | "desc";
}) {
  if (!active) {
    return (
      <span className="ml-1 inline-block text-gray-300 text-[10px] leading-none select-none">
        ↕
      </span>
    );
  }
  return (
    <span className="ml-1 inline-block text-amber-600 text-[10px] leading-none select-none">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const btnCls =
    "px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 " +
    "hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="flex items-center justify-between mt-4">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className={btnCls}
      >
        Previous
      </button>
      <span className="text-sm text-gray-500">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className={btnCls}
      >
        Next
      </button>
    </div>
  );
}
