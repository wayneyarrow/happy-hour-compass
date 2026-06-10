// ── CSV cell escaping ─────────────────────────────────────────────────────────

function escapeCell(val: string | null | undefined): string {
  const s = val == null ? "" : String(val);
  // Wrap in quotes if the value contains a comma, double-quote, or newline
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a CSV string from a header row and data rows.
 * Values are escaped per RFC 4180.
 */
export function buildCsv(
  headers: string[],
  rows: (string | null | undefined)[][]
): string {
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ];
  return lines.join("\n");
}

/**
 * Triggers a browser download of a CSV string.
 * Prepends a UTF-8 BOM so Excel opens the file without encoding issues.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
