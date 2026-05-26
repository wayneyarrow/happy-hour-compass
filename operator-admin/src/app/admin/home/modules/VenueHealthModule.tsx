export default function VenueHealthModule() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 flex-1">Venue Health</h3>
        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">
        A snapshot of your listing quality — profile completeness, photo score, and guest engagement signals.
      </p>
      <div className="mt-4 space-y-2">
        {["Profile completeness", "Photo quality", "Listing engagement"].map((label) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full w-0 bg-green-400 rounded-full" />
            </div>
            <span className="text-[10px] text-gray-400 w-24 text-right shrink-0">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
