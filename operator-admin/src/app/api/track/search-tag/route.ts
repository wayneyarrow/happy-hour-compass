import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tag, resultCount, sessionId } = body as Record<string, unknown>;

  if (typeof tag !== "string" || tag.length === 0) {
    return NextResponse.json({ error: "Invalid tag" }, { status: 400 });
  }
  if (
    typeof resultCount !== "number" ||
    !Number.isInteger(resultCount) ||
    resultCount < 0
  ) {
    return NextResponse.json({ error: "Invalid resultCount" }, { status: 400 });
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    await supabase.from("search_tag_events").insert({
      tag:          tag,
      result_count: resultCount,
      session_id:   sessionId,
    });
  } catch {
    // Intentionally swallowed — tracking failures must not affect the consumer.
  }

  return new NextResponse(null, { status: 204 });
}
