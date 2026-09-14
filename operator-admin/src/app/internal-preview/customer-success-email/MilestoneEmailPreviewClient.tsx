"use client";

import { useState } from "react";

export type MilestoneEmailVariant = {
  milestone: number;
  subject: string;
  previewText: string;
  html: string;
  text: string;
};

/**
 * Client-side milestone switcher for the Customer Success email preview.
 * Every variant is already fully rendered server-side (page.tsx) — this
 * component only switches which one is displayed. No network calls, no
 * analytics, no side effects.
 */
export function MilestoneEmailPreviewClient({
  variants,
  firstName,
  venueName,
}: {
  variants: MilestoneEmailVariant[];
  firstName: string;
  venueName: string;
}) {
  const [selectedMilestone, setSelectedMilestone] = useState(variants[0]?.milestone);
  const active = variants.find((v) => v.milestone === selectedMilestone) ?? variants[0];

  if (!active) {
    return (
      <div className="min-h-screen bg-slate-100 p-8">
        <p className="text-sm text-gray-500">No milestone variants available.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* ── Page heading ─────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Customer Success — Milestone Email Preview</h1>
          <p className="text-sm text-gray-500 mt-1">
            Internal design review only. Sample data: {firstName} &middot; {venueName}. Not linked from
            navigation, not indexed, no emails are sent from this page.
          </p>
        </div>

        {/* ── Milestone switcher ───────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-6">
          {variants.map((v) => {
            const isActive = v.milestone === active.milestone;
            return (
              <button
                key={v.milestone}
                type="button"
                onClick={() => setSelectedMilestone(v.milestone)}
                className={
                  "px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors " +
                  (isActive
                    ? "bg-amber-600 border-amber-600 text-white"
                    : "bg-white border-gray-200 text-gray-700 hover:border-amber-300 hover:text-amber-700")
                }
              >
                {v.milestone.toLocaleString("en-US")}
              </button>
            );
          })}
        </div>

        {/* ── Subject / preview text (outside the rendered email) ─────── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-5 mb-6">
          <dl className="space-y-3">
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Subject</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{active.subject}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Preview text</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{active.previewText}</dd>
            </div>
          </dl>
        </div>

        {/* ── Rendered email ────────────────────────────────────────────
            Rendered in an isolated iframe (srcDoc) — the email HTML ships
            its own <html>/<body>, so this avoids any CSS collision with
            the surrounding preview page and shows exactly what the email
            body itself looks like. */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-resting overflow-hidden">
          <iframe
            key={active.milestone}
            title={`Milestone email preview — ${active.milestone} views`}
            srcDoc={active.html}
            className="w-full"
            style={{ height: "900px", border: "none" }}
          />
        </div>

        {/* ── Plain-text alternative, for reference ────────────────────── */}
        <details className="mt-6">
          <summary className="text-sm font-semibold text-gray-500 cursor-pointer">
            Plain-text alternative
          </summary>
          <pre className="mt-3 bg-white rounded-xl border border-gray-200 shadow-resting p-5 text-sm text-gray-700 whitespace-pre-wrap">
            {active.text}
          </pre>
        </details>
      </div>
    </div>
  );
}
