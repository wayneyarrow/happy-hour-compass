"use client";

import { useState } from "react";
import { describeDownload, type DownloadSummary } from "@/lib/scoutReport/downloadMessage";

/**
 * "Download Scout report" — fetches /control-panel/analytics/scout-report
 * (founder-only; authorized server-side) and saves the JSON. Shows whether
 * the downloaded report is complete; an incomplete one is labelled as such
 * here, in its filename and in its JSON, with which sections failed and
 * whether a retry could help (only for failures that look temporary).
 */

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; filename: string; summary: DownloadSummary }
  | { kind: "error"; message: string };

export function ScoutReportDownload() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function download() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/control-panel/analytics/scout-report", { cache: "no-store", credentials: "same-origin", redirect: "manual" });
      if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) {
        setState({ kind: "error", message: "Your session has expired or you're not authorized. Sign in again and retry." });
        return;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) {
        setState({ kind: "error", message: `The report could not be generated (HTTP ${res.status}). Retry once; if it fails again, report it rather than retrying.` });
        return;
      }
      const blob = await res.blob();
      const filename = res.headers.get("x-scout-report-filename") ?? "hhc-scout-report.json";
      const summary = describeDownload(res.headers.get("x-scout-report-status"), res.headers.get("x-scout-report-sections"), res.headers.get("x-scout-report-retry"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState({ kind: "done", filename, summary });
    } catch {
      setState({ kind: "error", message: "The download failed (network error). Check your connection and retry." });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 pb-2">
      <button
        type="button"
        onClick={download}
        disabled={state.kind === "loading"}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 disabled:cursor-wait"
      >
        {state.kind === "loading" ? "Generating report…" : "Download Scout report"}
      </button>
      <div aria-live="polite" className="text-xs max-w-sm text-right">
        {state.kind === "idle" && <span className="text-gray-400">Previous complete week (Mon–Sun, Vancouver), JSON</span>}
        {state.kind === "loading" && <span className="text-gray-500">This can take up to a minute.</span>}
        {state.kind === "done" && state.summary.complete && <span className="text-emerald-700">Downloaded {state.filename} (complete).</span>}
        {state.kind === "done" && !state.summary.complete && (
          <span className="block text-amber-700">
            <span className="font-medium">Downloaded {state.filename}.</span>
            {state.summary.lines.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </span>
        )}
        {state.kind === "error" && <span className="text-red-600">{state.message}</span>}
      </div>
    </div>
  );
}
