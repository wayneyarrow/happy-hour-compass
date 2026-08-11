const SUPPORT_EMAIL = "support@happyhourcompass.com";
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

type Props = {
  /**
   * Compact vertical card for the Help Center landing page's top area,
   * alongside Getting Started — heading, short line, Contact Support
   * button, and the visible support address stacked below it. Default
   * (false) renders the original full-width horizontal bar shown at the
   * bottom of every other Help Center page (each article, Getting Started).
   */
  compact?: boolean;
};

/**
 * Consistent "Need help?" support path for the Help Center. Uses
 * support@happyhourcompass.com — the same address already used for support
 * contact on the Terms and Privacy pages — rather than a new support
 * channel. (Not hello@happyhourcompass.com, which is the transactional
 * sender address for operator emails elsewhere in the app.)
 */
export default function HelpNeedSupport({ compact = false }: Props) {
  if (compact) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-5 h-full flex flex-col">
        <h3 className="text-sm font-semibold text-gray-900">Need help?</h3>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          Can&rsquo;t find what you&rsquo;re looking for? We&rsquo;re here to help.
        </p>
        <div className="mt-4 flex flex-col items-start gap-2">
          <a
            href={SUPPORT_MAILTO}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
          >
            Contact Support
          </a>
          <a
            href={SUPPORT_MAILTO}
            className="text-xs text-gray-400 hover:text-amber-600 transition-colors"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Need help?</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Can&rsquo;t find what you&rsquo;re looking for? Our team typically responds within one business day.
        </p>
      </div>
      <a
        href={SUPPORT_MAILTO}
        className="shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
      >
        Contact Support
      </a>
    </div>
  );
}
