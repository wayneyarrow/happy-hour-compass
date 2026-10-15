/**
 * Download-button wording for the Scout report — pure and client-safe (no
 * server imports). Built from the route's X-Scout-Report-Sections and
 * X-Scout-Report-Retry headers.
 *
 * An incomplete report names which sections failed or are incomplete, says
 * the complete ones can be used with caveats (never as a complete report),
 * and suggests a retry only when a failure looks transient.
 */

export const SECTION_LABELS: Record<string, string> = {
  productUsage: "Product usage",
  searchDiscovery: "Search & Discovery",
  customerSuccess: "Customer success",
};

export type DownloadSummary = { complete: boolean; lines: string[] };

/** "productUsage=complete,searchDiscovery=failed" → { productUsage: "complete", … } */
export function parseSectionHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(",")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

export function describeDownload(status: string | null, sectionsHeader: string | null, retry: string | null): DownloadSummary {
  if (status === "complete") return { complete: true, lines: ["Complete."] };
  const sections = parseSectionHeader(sectionsHeader);
  const pick = (s: string) => Object.keys(sections).filter((k) => sections[k] === s).map((k) => SECTION_LABELS[k] ?? k);
  const failed = pick("failed");
  const partial = pick("incomplete");
  const ok = pick("complete");
  const lines = ["INCOMPLETE — don't treat this as a complete weekly report."];
  if (failed.length) lines.push(`Failed: ${failed.join(", ")}.`);
  if (partial.length) lines.push(`Partly missing: ${partial.join(", ")}.`);
  if (!failed.length && !partial.length) lines.push("Section status unavailable — see the completeness block in the file.");
  if (ok.length) lines.push(`Usable with caveats: ${ok.join(", ")}.`);
  lines.push(
    retry === "suggested"
      ? "A failure looks temporary — one retry in a few minutes may help."
      : retry === "may_help"
        ? "The cause is unclear — one retry is reasonable; if it fails the same way, report it."
        : "The failure doesn't look temporary — retrying is unlikely to help. The file explains each issue."
  );
  return { complete: false, lines };
}
