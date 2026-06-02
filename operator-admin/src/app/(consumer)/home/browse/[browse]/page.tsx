import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BROWSE_HUBS } from "../../browseCategories";
import { BrowseHubView } from "./BrowseHubView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ browse: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { browse } = await params;
  const hub = BROWSE_HUBS[browse];
  return { title: hub?.title ?? "Browse" };
}

export default async function BrowseHubPage({ params }: Props) {
  const { browse } = await params;
  const hub = BROWSE_HUBS[browse];
  if (!hub) notFound();

  return (
    <main className="bg-gray-50 min-h-full">
      <BrowseHubView title={hub.title} categories={hub.categories} />
    </main>
  );
}
