"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { buildVenueUpdate } from "@/lib/venueActions";
import { parseOperatorPlan } from "@/lib/plans";
import {
  isValidSearchTag,
  getSearchTagLimitForPlan,
  canUseSearchTags,
} from "@/lib/searchTags";
import { revalidatePath } from "next/cache";
import type { SearchTagsState } from "./types";

export async function updateSearchTagsAction(
  venueId: string,
  _prevState: SearchTagsState,
  formData: FormData
): Promise<SearchTagsState> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
    };
  }

  const plan = parseOperatorPlan(ctx.operator?.plan);

  if (!canUseSearchTags(plan)) {
    return {
      errors: { form: "Search tags are available on Pro and Premium plans. Upgrade to Pro to help guests find your venue with custom tags." },
    };
  }

  const limit = getSearchTagLimitForPlan(plan);

  // Parse the JSON tag array from the hidden form field
  const rawTags = (formData.get("search_tags") as string | null) ?? "[]";
  let tags: string[];
  try {
    const parsed: unknown = JSON.parse(rawTags);
    if (!Array.isArray(parsed)) {
      return { errors: { tags: "Invalid tag data submitted." } };
    }
    tags = (parsed as unknown[]).filter((t) => typeof t === "string") as string[];
  } catch {
    return { errors: { tags: "Invalid tag data submitted." } };
  }

  // Deduplicate
  tags = [...new Set(tags)];

  // Validate every tag against the controlled catalog
  const invalid = tags.filter((t) => !isValidSearchTag(t));
  if (invalid.length > 0) {
    return {
      errors: { tags: `Unrecognized tags submitted: ${invalid.join(", ")}` },
    };
  }

  // Enforce plan tag limit
  if (limit !== Infinity && tags.length > limit) {
    return {
      errors: {
        tags: `Your plan allows up to ${limit} search tag${limit === 1 ? "" : "s"}. You selected ${tags.length}.`,
      },
    };
  }

  const updates = {
    search_tags: tags,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error: updateError, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (updateError) {
    console.error("[updateSearchTagsAction] Update failed:", updateError);
    return { errors: { form: `Failed to save: ${updateError.message}` } };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
    };
  }

  revalidatePath("/admin/venue");
  return { success: true, values: { tags } };
}
