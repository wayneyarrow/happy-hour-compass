/**
 * Consistent "Need help?" support path, shown at the bottom of every Help
 * Center page. Uses the existing Happy Hour Compass support address
 * (hello@happyhourcompass.com — the same address used for the cancelled-venue
 * screen in app/admin/layout.tsx and as the sender for all operator email)
 * rather than a new support channel.
 */
export default function HelpNeedSupport() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Need help?</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Can&rsquo;t find what you&rsquo;re looking for? Our team typically responds within one business day.
        </p>
      </div>
      <a
        href="mailto:hello@happyhourcompass.com"
        className="shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
      >
        Contact Support
      </a>
    </div>
  );
}
