export default function VenueSnapshotModule() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 md:col-span-2">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 flex-1">Venue Snapshot</h3>
        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Key metrics at a glance — views, clicks, and how your venue compares to others in your market.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Listing views", value: "—" },
          { label: "Menu link clicks", value: "—" },
          { label: "Market rank", value: "—" },
        ].map(({ label, value }) => (
          <div key={label} className="text-center p-3 bg-gray-50 rounded-lg border border-gray-100">
            <p className="text-xl font-bold text-gray-300">{value}</p>
            <p className="text-[10px] text-gray-400 mt-1 leading-snug">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
