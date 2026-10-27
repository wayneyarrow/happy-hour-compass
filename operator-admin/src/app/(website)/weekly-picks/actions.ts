"use server";

import { headers } from "next/headers";
import { getClientIpFromHeaders, TURNSTILE_TOKEN_FIELD } from "@/lib/turnstile";
import { processWeeklyPicksSignup, type WeeklyPicksSignupState } from "@/lib/weeklyPicks/signup";

/**
 * The single server action behind every Weekly Picks signup form
 * (WeeklyPicksSignupForm — /weekly-picks, homepage, guides). Thin wrapper:
 * all logic, including Turnstile verification before any Brevo request,
 * lives in processWeeklyPicksSignup().
 */
export async function subscribeToWeeklyPicks(formData: FormData): Promise<WeeklyPicksSignupState> {
  const heads = await headers();
  return processWeeklyPicksSignup({
    email: formData.get("email"),
    placement: formData.get("placement"),
    turnstileToken: formData.get(TURNSTILE_TOKEN_FIELD),
    remoteIp: getClientIpFromHeaders(heads),
  });
}
