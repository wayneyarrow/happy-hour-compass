/**
 * Standalone layout — clean, centered, no phone frame, no nav.
 * Used for secure public forms (e.g. the operator more-info verification form).
 */
export default function StandaloneLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Simple branded header */}
      <header className="bg-white border-b border-gray-200 px-5 py-4 flex items-center">
        <span className="text-[13px] font-bold text-amber-600 tracking-wide uppercase">
          Happy Hour Compass
        </span>
      </header>

      {/* Content — centered card on desktop, full-width on mobile */}
      <main className="flex-1 w-full px-4 py-10 flex flex-col items-center">
        <div className="w-full max-w-lg">
          {children}
        </div>
      </main>

      <footer className="py-6 text-center text-xs text-gray-400">
        &copy; {new Date().getFullYear()} Happy Hour Compass
      </footer>
    </div>
  );
}
