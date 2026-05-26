export default function SuggestedNextStepsModule() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 md:col-span-2">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 flex-1">Suggested Next Steps</h3>
        <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Personalised actions to help you get more from your listing — based on your venue type, completion, and local market.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: "📸", label: "Add more photos", desc: "Listings with 3+ photos get more clicks." },
          { icon: "🍺", label: "Refine your specials", desc: "Detailed specials convert more guest visits." },
          { icon: "📅", label: "Keep hours current", desc: "Outdated hours are the #1 guest complaint." },
        ].map(({ icon, label, desc }) => (
          <div key={label} className="flex items-start gap-2.5 p-3 rounded-lg bg-gray-50 border border-gray-100">
            <span className="text-base shrink-0" aria-hidden="true">{icon}</span>
            <div>
              <p className="text-xs font-semibold text-gray-700">{label}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
