export const dynamic = "force-dynamic";
export const metadata = { title: "Specials Adoption — Action Center" };

import Link from "next/link";
import { getSpecialsAdoptionReport } from "@/lib/data/specialsAdoption";
import { CAMPAIGN_MIN_DAYS_SINCE_ACTIVATION } from "@/lib/customerSuccess/specialsAdoptionPolicy";
import ReportTable from "./ReportTable";

type PageProps = { searchParams: Promise<{ view?: string }> };

export default async function SpecialsAdoptionPage({ searchParams }: PageProps) {
  const { view } = await searchParams;
  const campaignView = view === "campaign";

  const allRows = await getSpecialsAdoptionReport();
  const candidateRows = allRows.filter((r) => r.isCampaignCandidate);
  const adoptedVenues = allRows.filter((r) => r.counts.operatorTotal > 0).length;
  const rows = campaignView ? candidateRows : allRows;

  const tabCls = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      active ? "bg-slate-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
    }`;

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Specials Adoption</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every verified venue and its Daily Specials. Adoption counts venues with at least one
          operator-created Daily Special — seeded/platform Specials never count.
        </p>
      </div>

      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
        <strong>{adoptedVenues}</strong> of <strong>{allRows.length}</strong> verified{" "}
        {allRows.length === 1 ? "venue has" : "venues have"} created at least one Daily Special.{" "}
        <strong>{candidateRows.length}</strong> {candidateRows.length === 1 ? "is a" : "are"} campaign{" "}
        {candidateRows.length === 1 ? "candidate" : "candidates"}.
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/control-panel/action-center/reports/specials-adoption" className={tabCls(!campaignView)}>
          All verified venues ({allRows.length})
        </Link>
        <Link href="/control-panel/action-center/reports/specials-adoption?view=campaign" className={tabCls(campaignView)}>
          Campaign candidates ({candidateRows.length})
        </Link>
      </div>

      {campaignView && (
        <p className="mb-4 text-xs text-gray-500">
          Campaign candidates: verified venues whose operator activated their account at least{" "}
          {CAMPAIGN_MIN_DAYS_SINCE_ACTIVATION} days ago, with onboarding in progress or complete and zero
          operator-created Daily Specials (drafts count as created). Venues with no activation date are excluded.
        </p>
      )}

      <ReportTable rows={rows} csvName={campaignView ? "specials-campaign-candidates" : "specials-adoption"} />

      <div className="mt-6 space-y-1 text-xs text-gray-400 leading-relaxed">
        <p>
          <strong className="text-gray-500">Operator-created</strong> — decided by how the Special was created, never by
          later edits: not seeded, created by the operator&apos;s own login (not HHC staff using Open as Operator or
          support mode). A seeded or HHC-created Special the operator later edits stays seeded/platform. Each one-time
          date is its own entry; a weekly Special is one entry however many weeks it runs.
        </p>
        <p>
          <strong className="text-gray-500">Total</strong> — operator-created Specials that currently exist, published
          or draft. Deleted Specials are gone and not counted.{" "}
          <strong className="text-gray-500">Current/upcoming</strong> — published, and a one-time date that is today or
          later, or a weekly Special with an occurrence still ahead — judged in the venue&apos;s local time, the same rule
          that decides what consumers see.
        </p>
        <p>
          <strong className="text-gray-500">Activated</strong> — days since the operator activated their account, the
          same age the Venue Funnel shows as &ldquo;Since account activated&rdquo;.
        </p>
      </div>
    </div>
  );
}
