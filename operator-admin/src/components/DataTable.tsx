import React from "react";

// ── DataTable ─────────────────────────────────────────────────────────────────
// Visual foundation for all control-panel and admin list tables.
// Standardises the wrapper, header row, data rows, and hover treatment.
// Existing tables can adopt this incrementally — wrap the outer div and thead
// to gain the consistent style without rewriting sort/filter logic.

type DataTableProps = {
  children: React.ReactNode;
  className?: string;
};

export function DataTable({ children, className = "" }: DataTableProps) {
  return (
    <div className={`overflow-hidden rounded-xl border border-gray-200 shadow-sm ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

// ── DataTableHead ─────────────────────────────────────────────────────────────

export function DataTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="bg-gray-50 border-b border-gray-200">{children}</tr>
    </thead>
  );
}

// ── DataTableHeadCell ─────────────────────────────────────────────────────────

type HeadCellProps = {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
};

export function DataTableHeadCell({ children, className = "", align = "left" }: HeadCellProps) {
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap ${alignCls} ${className}`}
    >
      {children}
    </th>
  );
}

// ── DataTableBody ─────────────────────────────────────────────────────────────

export function DataTableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-gray-100">{children}</tbody>;
}

// ── DataTableRow ──────────────────────────────────────────────────────────────

type RowProps = {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
};

export function DataTableRow({ children, onClick, className = "" }: RowProps) {
  const interactiveCls = onClick
    ? "cursor-pointer hover:bg-amber-50 transition-colors"
    : "hover:bg-gray-50 transition-colors";
  return (
    <tr onClick={onClick} className={`${interactiveCls} ${className}`}>
      {children}
    </tr>
  );
}

// ── DataTableCell ─────────────────────────────────────────────────────────────

type CellProps = {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
};

export function DataTableCell({ children, className = "", align = "left" }: CellProps) {
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <td className={`px-4 py-3.5 text-sm text-gray-900 ${alignCls} ${className}`}>
      {children}
    </td>
  );
}

// ── DataTableEmpty ────────────────────────────────────────────────────────────
// Inline empty state for use inside the table wrapper (no rows to display).

export function DataTableEmpty({ message = "No results found." }: { message?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
