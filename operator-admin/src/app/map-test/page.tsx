/**
 * TEMPORARY DIAGNOSTIC PAGE — /map-test
 *
 * Renders a bare Google Map with two hardcoded/fetched venue markers,
 * completely outside the (consumer) layout shell (no phone frame, no
 * overflow-y-auto container, no filter UI, no list).
 *
 * Purpose: isolate whether marker misalignment reproduces in a plain
 * full-page map with no app-shell CSS context.
 *
 * Delete this file once the root cause is confirmed.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { MapTestClient } from "./MapTestClient";

export const dynamic = "force-dynamic";

/** Hardcoded BNA coordinates for this diagnostic. */
const BNA = {
  name: "BNA Brewing Co. & Eatery",
  lat: 49.8927871,
  lng: -119.4963678,
};

export default async function MapTestPage() {
  // Fetch Central Kitchen + Bar from the DB to use its live stored coordinates.
  let centralKitchen: { name: string; lat: number; lng: number } | null = null;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("venues")
      .select("name, lat, lng")
      .ilike("name", "%central kitchen%")
      .limit(1)
      .maybeSingle();

    if (data && typeof data.lat === "number" && typeof data.lng === "number") {
      centralKitchen = { name: data.name as string, lat: data.lat, lng: data.lng };
    }
  } catch {
    // Non-fatal — diagnostic still works with BNA alone.
  }

  const markers = [
    BNA,
    ...(centralKitchen ? [centralKitchen] : []),
  ];

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 13 }}>
      <h1 style={{ fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
        MAP DIAGNOSTIC — /map-test
      </h1>
      <p style={{ color: "#666", marginBottom: 4 }}>
        Bare page outside consumer layout. No phone frame, no overflow container.
      </p>
      <ul style={{ marginBottom: 12, paddingLeft: 20, color: "#333" }}>
        {markers.map((m) => (
          <li key={m.name}>
            <strong>{m.name}</strong> — {m.lat}, {m.lng}
          </li>
        ))}
        {!centralKitchen && (
          <li style={{ color: "#c00" }}>
            Central Kitchen + Bar: not found in DB (check name match)
          </li>
        )}
      </ul>
      {/* Full-viewport map below the legend */}
      <MapTestClient markers={markers} />
    </div>
  );
}
