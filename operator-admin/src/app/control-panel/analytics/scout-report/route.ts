/**
 * GET /control-panel/analytics/scout-report — founder-only download of the
 * Scout "Product Usage & Discovery" report (versioned JSON).
 *
 * Authorization: requireControlPanelAdmin() runs first, before any data is
 * read (logged out → /control-panel-login, not an admin → /), the same check
 * every Control Panel page uses; middleware also redirects logged-out
 * /control-panel/* requests. No query parameters are accepted — the window
 * is always the previous complete Vancouver week (buildScoutReport).
 *
 * The response is never cacheable (private, no-store). An incomplete report
 * is still returned (its complete sections remain usable with caveats), but
 * it is labelled in the JSON (`status`, `completeness`), the filename
 * (_INCOMPLETE) and the X-Scout-Report-* headers the download button reads:
 * per-section status and whether a retry could help (only for failures that
 * look transient).
 */

import { NextResponse } from "next/server";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";
import { buildScoutReport, scoutReportFilename } from "@/lib/scoutReport/buildScoutReport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  // Authorize before any data read — see requireControlPanelAdmin.ts.
  await requireControlPanelAdmin();

  let report: Awaited<ReturnType<typeof buildScoutReport>>;
  try {
    report = await buildScoutReport({ now: new Date() });
  } catch (e) {
    console.error("[control-panel/scout-report] report build failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "The Scout report could not be generated. Please retry." }, { status: 500, headers: NO_STORE });
  }

  const filename = scoutReportFilename(report);
  return new NextResponse(JSON.stringify(report, null, 2), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Scout-Report-Status": report.status,
      "X-Scout-Report-Incomplete-Sections": report.incompleteSections.join(","),
      "X-Scout-Report-Sections": Object.entries(report.completeness.sections)
        .map(([k, v]) => `${k}=${v.status}`)
        .join(","),
      "X-Scout-Report-Retry": report.completeness.retry,
      "X-Scout-Report-Filename": filename,
    },
  });
}
