/**
 * ImpersonateButton — Control Panel venue detail page.
 *
 * A plain HTML form (no client JS) that POSTs to /api/impersonate/start with
 * target="_blank" to open the Operator Admin in a new tab.
 *
 * The POST route handler:
 *   1. Verifies the caller is authenticated and in CONTROL_PANEL_ADMIN_EMAILS
 *   2. Creates an operator_impersonation_sessions row
 *   3. Sets an httpOnly imp_session_id cookie
 *   4. Redirects the new tab to /admin/venue
 *
 * Using target="_blank" on the form avoids async popup-blocking (no window.open
 * after an await). The browser submits the form synchronously in a new tab.
 */

interface Props {
  venueId: string;
}

export default function ImpersonateButton({ venueId }: Props) {
  return (
    <form method="post" action="/api/impersonate/start" target="_blank">
      <input type="hidden" name="venue_id" value={venueId} />
      <button
        type="submit"
        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
        Open as Operator
      </button>
    </form>
  );
}
