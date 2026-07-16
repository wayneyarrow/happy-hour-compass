import type { JobOpening } from "./content";

type Props = {
  openings: readonly JobOpening[];
};

/**
 * Renders either the honest "no openings" empty state (today) or a plain
 * list of real postings (once OPEN_POSITIONS in content.tsx has any) —
 * the one branch point that lets real job listings get added later without
 * touching page.tsx or rebuilding this section. No CMS, no job detail
 * route: just a typed array and a conditional render, per the V1 scope.
 */
export function CurrentOpenings({ openings }: Props) {
  if (openings.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-10 md:p-12 text-center">
        <h3 className="text-lg md:text-xl font-bold text-gray-900">
          No open positions right now
        </h3>
        <p className="mt-3 text-base text-gray-500 leading-relaxed max-w-md mx-auto">
          We don&rsquo;t have any roles posted today, but that will change as
          Happy Hour Compass grows.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {openings.map((job) => (
        <li
          key={job.id}
          className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-6 flex items-center justify-between gap-4"
        >
          <div>
            <p className="font-semibold text-gray-900">{job.title}</p>
            <p className="mt-0.5 text-sm text-gray-500">
              {job.department} · {job.location}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
