export default function IndustryReadsModule() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 flex-1">Industry Reads</h3>
        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Curated articles and insights on hospitality trends, marketing tips, and happy hour best practices.
      </p>
      <div className="space-y-3">
        {[
          "How to write specials that actually drive foot traffic",
          "The right time to post your happy hour on social media",
          "What guests look for before choosing a venue",
        ].map((title) => (
          <div key={title} className="flex items-start gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-300 shrink-0 mt-1.5" />
            <p className="text-xs text-gray-400 leading-snug">{title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
