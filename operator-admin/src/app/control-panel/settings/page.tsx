export const dynamic = "force-dynamic";
export const metadata = { title: "Venue QA" };

import { QaPublishPanel } from "./QaPublishPanel";
import { QaHhReviewPanel } from "./QaHhReviewPanel";

export default function ControlPanelSettingsPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Venue QA</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tools for reviewing and publishing imported venue data before it goes live.
        </p>
      </div>
      <div className="space-y-6">
        <QaPublishPanel />
        <QaHhReviewPanel />
      </div>
    </div>
  );
}
