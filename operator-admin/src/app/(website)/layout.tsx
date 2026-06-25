import type { ReactNode } from "react";
import Link from "next/link";

export default function WebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="text-xl font-bold text-gray-900 tracking-tight">
              Happy Hour{" "}
              <span className="text-amber-500">Compass</span>
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-8">
            <Link
              href="/#discover"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Discover
            </Link>
            <Link
              href="/#for-owners"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              For Owners
            </Link>
            <Link
              href="/login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/suggest/owner"
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-full transition-colors"
            >
              List your venue
            </Link>
          </nav>
          <button className="md:hidden p-2 text-gray-600 hover:text-gray-900">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div>
              <p className="text-sm font-bold text-gray-900">
                Happy Hour <span className="text-amber-500">Compass</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Find the best happy hours near you.
              </p>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/suggest/owner" className="text-xs text-gray-500 hover:text-gray-900 transition-colors">
                List your venue
              </Link>
              <Link href="/login" className="text-xs text-gray-500 hover:text-gray-900 transition-colors">
                Operator login
              </Link>
            </div>
          </div>
          <p className="mt-8 text-xs text-gray-400">
            © {new Date().getFullYear()} Happy Hour Compass. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
