import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b border-gray-200 px-5 py-4 flex items-center justify-between bg-white sticky top-0 z-10">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-gray-800 hover:text-amber-600 transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Happy Hour Compass
        </Link>
        <span className="text-xs text-gray-400">Legal</span>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-5 py-10">
        {children}
      </main>

      <footer className="border-t border-gray-100 px-5 py-8 text-center space-y-3">
        <div className="flex items-center justify-center gap-5 text-xs text-gray-500">
          <Link href="/privacy" className="hover:text-amber-600 transition-colors">Privacy Policy</Link>
          <span className="text-gray-300">·</span>
          <Link href="/terms" className="hover:text-amber-600 transition-colors">Terms of Service</Link>
          <span className="text-gray-300">·</span>
          <a href="mailto:support@happyhourcompass.com" className="hover:text-amber-600 transition-colors">Contact</a>
        </div>
        <p className="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Yellow Lab Software. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
