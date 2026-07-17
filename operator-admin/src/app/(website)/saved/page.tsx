import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { SavedPageClient } from "./SavedPageClient";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const { market } = await getActiveMarket();
  return <SavedPageClient market={market} />;
}
