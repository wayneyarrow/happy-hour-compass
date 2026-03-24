import { QaPublishPanel } from "./QaPublishPanel";

export default function ControlPanelSettingsPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Platform configuration and administrative actions.
        </p>
      </div>
      <div className="space-y-6">
        <QaPublishPanel />
      </div>
    </div>
  );
}
