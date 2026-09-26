import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import {
  extractEmailDomain,
  extractWebsiteDomain,
  isPublicEmailDomain,
  normalizeCountry,
  normalizePhone,
} from "@/lib/trustSignals";
import { planActivationVerificationMode } from "@/lib/activation/emailCodeActivationStart";
import { isClaimAutoApprovalEnabled } from "./claimAutoApprovalConfig";
import type { ClaimSignals } from "./claimAutoApprovalPolicy";

/**
 * Gathers the normalized facts the claim auto-approval policy needs, from
 * existing data only (no schema change) plus trusted request geo.
 * Read-only: never writes, sends, or calls an external service.
 *
 * Deliberately does NOT reuse the Control Panel's trustSignals statuses —
 * those are reviewer-facing and stricter than the agreed policy (any phone
 * mismatch is a "warning", >100 km is "Far", any prior claim is a
 * "warning"). Only its pure helpers (domain/phone/country normalization,
 * public-mailbox list) are reused.
 *
 * GEO: ip-api.com is NOT used (external, plain HTTP, non-commercial free
 * tier). Location comes from Vercel's edge-set request headers
 * (x-vercel-ip-country / -country-region / -city / -latitude / -longitude),
 * trusted only when actually running on Vercel (VERCEL=1) — elsewhere a
 * caller could send them. Missing/untrusted → geo UNKNOWN, which is
 * neutral, never a reason for review.
 */

/**
 * Website hosts that say nothing about who owns a venue (a claimant's email
 * at these domains proves nothing, and a claimant elsewhere isn't a
 * "mismatch"). Compared on the registrable domain and any subdomain.
 */
const PLATFORM_WEBSITE_DOMAINS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "bento.me",
  "carrd.co",
  "google.com",
  "business.site",
  "godaddysites.com",
  "wixsite.com",
  "weebly.com",
  "squarespace.com",
  "square.site",
  "squareup.com",
  "wordpress.com",
  "shopify.com",
  "myshopify.com",
  "toasttab.com",
  "opentable.com",
  "opentable.ca",
  "resy.com",
  "exploretock.com",
  "sevenrooms.com",
  "yelp.com",
  "yelp.ca",
  "tripadvisor.com",
  "tripadvisor.ca",
  "ubereats.com",
  "doordash.com",
  "skipthedishes.com",
  "clover.com",
];

export function isPlatformWebsiteDomain(domain: string): boolean {
  return PLATFORM_WEBSITE_DOMAINS.some((p) => domain === p || domain.endsWith(`.${p}`));
}

/** The venue website's ownership-meaningful domain, or null (none, unparseable, or a platform host). */
export function meaningfulWebsiteDomain(websiteUrl: string | null | undefined): string | null {
  const domain = extractWebsiteDomain(websiteUrl);
  if (!domain || isPlatformWebsiteDomain(domain)) return null;
  return domain;
}

/** Last 10 digits (NANP), so "+1 (250) 555-0100", "250-555-0100", and "12505550100" compare equal. */
export function phoneLast10(phone: string | null | undefined): string | null {
  // Drop a trailing extension ("ext. 9", "x12") so it can't shift the digits.
  const digits = normalizePhone((phone ?? "").replace(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i, ""));
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export type TrustedGeo = {
  resolved: boolean;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
};

const UNKNOWN_GEO: TrustedGeo = { resolved: false, countryCode: null, region: null, city: null, lat: null, lng: null };

/** Reads Vercel's edge geo headers. Only trusted on Vercel; otherwise UNKNOWN (neutral). */
export function readTrustedGeo(headers: Headers, trusted: boolean = process.env.VERCEL === "1"): TrustedGeo {
  if (!trusted) return UNKNOWN_GEO;
  const country = headers.get("x-vercel-ip-country")?.trim();
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return UNKNOWN_GEO;
  const decode = (v: string | null) => {
    if (!v) return null;
    try {
      return decodeURIComponent(v).trim() || null;
    } catch {
      return null;
    }
  };
  const lat = Number(headers.get("x-vercel-ip-latitude"));
  const lng = Number(headers.get("x-vercel-ip-longitude"));
  const coordsOk = headers.has("x-vercel-ip-latitude") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    resolved: true,
    countryCode: country.toLowerCase(),
    region: decode(headers.get("x-vercel-ip-country-region")),
    city: decode(headers.get("x-vercel-ip-city")),
    lat: coordsOk ? lat : null,
    lng: coordsOk ? lng : null,
  };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type ClaimSignalInput = {
  claim: { id: string; email: string; phone: string | null; position: string; ipAddress: string | null };
  venue: {
    id: string;
    name: string;
    country: string | null;
    lat: number | null;
    lng: number | null;
    phone: string | null;
    websiteUrl: string | null;
    claimedAt: string | null;
    claimedBy: string | null;
    createdByOperatorId: string | null;
  };
  requestHeaders: Headers;
};

export type GatherClaimSignalsDeps = {
  admin?: SupabaseClient;
  now?: () => Date;
  autoApprovalEnabled?: () => boolean;
  emailCodeAvailable?: () => boolean;
  trustGeoHeaders?: boolean;
};

const OPEN_CLAIM_STATUSES = ["needs_more_info", "info_submitted"];
const OPEN_SUBMISSION_STATUSES = ["new", "pending_review", "double_claim", "needs_more_info", "info_submitted"];

export async function gatherClaimSignals(input: ClaimSignalInput, deps: GatherClaimSignalsDeps = {}): Promise<ClaimSignals> {
  const admin = deps.admin ?? (createAdminClient() as unknown as SupabaseClient);
  const now = (deps.now ?? (() => new Date()))();
  const email = input.claim.email.trim().toLowerCase();
  const emailDomain = extractEmailDomain(email);
  let readFailed = false;
  const read = <T>(res: { data: T | null; error: unknown }): T | null => {
    if (res.error) readFailed = true;
    return res.data;
  };

  // ── Conflicts ──────────────────────────────────────────────────────────────
  const openClaims =
    read(
      await admin
        .from("venue_claims")
        .select("id, status")
        .eq("venue_id", input.venue.id)
        .in("status", OPEN_CLAIM_STATUSES)
    ) ?? [];
  const competingOpenClaim = (openClaims as { id: string; status: string }[]).find((c) => c.id !== input.claim.id) ?? null;

  const openSubmissions =
    read(
      await admin
        .from("operator_submissions")
        .select("id, status")
        .eq("venue_id", input.venue.id)
        .in("status", OPEN_SUBMISSION_STATUSES)
    ) ?? [];

  const rejected =
    read(await admin.from("venue_claims").select("id, email").eq("venue_id", input.venue.id).eq("status", "rejected")) ?? [];
  const rejectedEmails = (rejected as { email: string }[]).map((r) => (r.email ?? "").trim().toLowerCase());

  // ── Velocity (this claim is already inserted, so counts include it) ──────
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const emailClaims = read(await admin.from("venue_claims").select("id").eq("email", email).gt("created_at", since)) ?? [];
  const ipClaims = input.claim.ipAddress
    ? read(await admin.from("venue_claims").select("id").eq("ip_address", input.claim.ipAddress).gt("created_at", since)) ?? []
    : null;

  // ── Existing operator / account ────────────────────────────────────────────
  const operator = read(await admin.from("operators").select("id, account_activated_at").eq("email", email).maybeSingle()) as {
    id: string;
    account_activated_at: string | null;
  } | null;
  let incompatibleLegacyLifecycle = false;
  let nonOperatorAccountKind: ClaimSignals["conflicts"]["nonOperatorAccountKind"] = null;
  if (operator && !operator.account_activated_at) {
    const live = read(
      await admin
        .from("operator_activation_lifecycles")
        .select("verification_required")
        .eq("operator_id", operator.id)
        .is("expired_at", null)
        .is("released_at", null)
        .maybeSingle()
    ) as { verification_required: boolean | null } | null;
    incompatibleLegacyLifecycle = !!live && live.verification_required !== true;
  } else if (!operator) {
    // Every non-operator HHC login is one of these (verified against
    // auth.users when this was built). Automatic provisioning can't adopt
    // them, so they go to founder review (H5).
    const consumer = read(await admin.from("consumer_profiles").select("id").eq("email", email).limit(1)) ?? [];
    const platformAdmin = read(await admin.from("platform_admins").select("id").eq("email", email).limit(1)) ?? [];
    const member = read(await admin.from("operator_memberships").select("id").eq("email", email).limit(1)) ?? [];
    nonOperatorAccountKind = (platformAdmin as unknown[]).length
      ? "platform_admin"
      : (member as unknown[]).length
        ? "team_member"
        : (consumer as unknown[]).length
          ? "consumer"
          : null;
  }

  // ── Geo (trusted request headers only) ─────────────────────────────────────
  const geo = readTrustedGeo(input.requestHeaders, deps.trustGeoHeaders);
  const venueCountryCode = input.venue.country ? normalizeCountry(input.venue.country) : null;
  const distanceKm =
    geo.resolved && geo.lat !== null && geo.lng !== null && input.venue.lat !== null && input.venue.lng !== null
      ? haversineKm(geo.lat, geo.lng, input.venue.lat, input.venue.lng)
      : null;

  // "Is the email-code flow available for THIS claimant's activation?" is
  // answered by the one decision point that already owns that question
  // (flag + HMAC secret + existing-lifecycle compatibility). An activated
  // operator has no activation step, so it doesn't apply to them. A live
  // legacy lifecycle is reported separately (incompatibleLegacyLifecycle)
  // so its review message can say exactly that.
  const emailCodeAvailable =
    deps.emailCodeAvailable?.() ??
    (operator?.account_activated_at
      ? true
      : incompatibleLegacyLifecycle || (await planActivationVerificationMode({ email }, { adminClient: admin })) === "email_code");

  return {
    infrastructure: {
      autoApprovalEnabled: deps.autoApprovalEnabled?.() ?? isClaimAutoApprovalEnabled(),
      emailCodeAvailable,
      incompatibleLegacyLifecycle,
      signalReadFailed: readFailed,
    },
    venue: {
      name: input.venue.name,
      country: input.venue.country,
      websiteDomain: meaningfulWebsiteDomain(input.venue.websiteUrl),
      phone: input.venue.phone,
      phoneLast10: phoneLast10(input.venue.phone),
    },
    claimant: {
      email,
      emailDomain,
      isPublicEmailDomain: isPublicEmailDomain(emailDomain),
      phone: input.claim.phone,
      phoneLast10: phoneLast10(input.claim.phone),
      role: input.claim.position,
    },
    conflicts: {
      competingOpenClaimStatus: competingOpenClaim?.status ?? null,
      competingOpenSubmissionStatus: (openSubmissions as { status: string }[])[0]?.status ?? null,
      inconsistentOwnership: !input.venue.claimedAt && (!!input.venue.claimedBy || !!input.venue.createdByOperatorId),
      priorRejectionSameEmail: rejectedEmails.includes(email),
      priorRejectionOtherEmail: rejectedEmails.some((e) => e && e !== email),
      nonOperatorAccountKind,
    },
    velocity: {
      emailClaims24h: (emailClaims as unknown[]).length,
      ipClaims24h: ipClaims ? (ipClaims as unknown[]).length : null,
    },
    geo: {
      resolved: geo.resolved,
      country: geo.countryCode ? geo.countryCode.toUpperCase() : null,
      region: geo.region,
      city: geo.city,
      ipCountryCode: geo.countryCode ? normalizeCountry(geo.countryCode) : null,
      venueCountryCode,
      distanceKm,
    },
    existingOperator: { exists: !!operator, activated: !!operator?.account_activated_at },
  };
}
