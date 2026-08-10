import Link from "next/link";

/**
 * Shared breadcrumb trail for every Help Center page below the landing page.
 * Always anchors back to /admin/help — the Help Center has a deliberately
 * shallow information architecture, so this two-level trail (Help → current
 * page) is sufficient for V1.
 */
export default function HelpBreadcrumbs({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-gray-400">
        <li>
          <Link href="/admin/help" className="hover:text-gray-600 transition-colors">
            Help
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li className="text-gray-600 font-medium truncate">{current}</li>
      </ol>
    </nav>
  );
}
