import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Force dynamic so the health check always runs fresh (no static caching).
export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();

  // Lightweight database connectivity check: HEAD-only request, no rows returned.
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("venues")
      .select("id", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        { status: "degraded", database: "error", timestamp },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { status: "ok", database: "ok", timestamp },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "unreachable", timestamp },
      { status: 503 }
    );
  }
}
