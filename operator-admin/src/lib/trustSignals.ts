/**
 * Trust signal helpers for the Admin Control Panel claim review screen.
 *
 * All logic here is heuristic and transparent — it is designed to surface
 * signals for a human reviewer, not to make automated decisions.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SignalStatus = "positive" | "warning" | "negative" | "neutral";

export type TrustSignal = {
  key: string;
  label: string;
  status: SignalStatus;
  detail: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// Free / public mailbox providers — not exhaustive, covers common cases.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.ca",
  "icloud.com",
  "me.com",
  "mac.com",
  "live.com",
  "live.co.uk",
  "live.ca",
  "msn.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "ymail.com",
]);

export function extractEmailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase().trim() ?? "";
}

export function extractWebsiteDomain(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  try {
    const normalised = url.startsWith("http") ? url : `https://${url}`;
    const { hostname } = new URL(normalised);
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain);
}

/** Strip all non-digit characters from a phone string. */
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

// ── Signal builders ──────────────────────────────────────────────────────────

function emailDomainSignal(
  _claimantEmail: string,
  venueWebsite: string | null | undefined,
  emailDomain: string,
  isPublic: boolean
): TrustSignal {
  if (isPublic) {
    return {
      key: "email_domain",
      label: "Email domain match",
      status: "neutral",
      detail: `Public mailbox (${emailDomain}) — domain match not applicable.`,
    };
  }

  const websiteDomain = extractWebsiteDomain(venueWebsite);
  if (!websiteDomain) {
    return {
      key: "email_domain",
      label: "Email domain match",
      status: "neutral",
      detail: "No venue website on file — cannot compare domains.",
    };
  }

  // Accept exact match or subdomain match (e.g. staff.moxies.com vs moxies.com)
  const match =
    emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`);

  return {
    key: "email_domain",
    label: "Email domain match",
    status: match ? "positive" : "warning",
    detail: match
      ? `${emailDomain} matches venue domain ${websiteDomain}.`
      : `${emailDomain} does not match venue domain ${websiteDomain}.`,
  };
}

function publicEmailSignal(domain: string, isPublic: boolean): TrustSignal {
  return {
    key: "public_email",
    label: "Public email provider",
    status: isPublic ? "warning" : "positive",
    detail: isPublic
      ? `${domain} is a personal/free mailbox, not a business domain.`
      : `${domain} appears to be a business domain.`,
  };
}

function roleSignal(position: string): TrustSignal {
  const strong = ["Owner", "Manager"];
  const moderate = ["Bartender", "Server"];
  const isStrong = strong.includes(position);
  const isModerate = moderate.includes(position);

  return {
    key: "role",
    label: "Submitted role",
    status: isStrong ? "positive" : isModerate ? "warning" : "neutral",
    detail: isStrong
      ? `${position} — strong operational signal.`
      : isModerate
      ? `${position} — plausible but weaker ownership signal.`
      : `${position} — limited ownership signal.`,
  };
}

function phoneSignal(
  claimantPhone: string | null | undefined,
  venuePhone: string | null | undefined
): TrustSignal {
  const claimNorm = normalizePhone(claimantPhone);
  const venueNorm = normalizePhone(venuePhone);

  if (!venueNorm) {
    return {
      key: "phone",
      label: "Phone match",
      status: "neutral",
      detail: "No venue phone on file — cannot compare.",
    };
  }

  if (!claimNorm) {
    return {
      key: "phone",
      label: "Phone match",
      status: "neutral",
      detail: "No phone submitted with claim.",
    };
  }

  const match = claimNorm === venueNorm;
  return {
    key: "phone",
    label: "Phone match",
    status: match ? "positive" : "warning",
    detail: match
      ? "Submitted phone matches venue phone exactly."
      : `Submitted phone (${claimantPhone}) differs from venue phone (${venuePhone}).`,
  };
}

// ── Country normalization ─────────────────────────────────────────────────────

/**
 * Maps ISO-2 codes and common aliases (lowercased) → canonical ISO-2 key.
 * Covers the countries most likely to appear in venue data or ip-api responses.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  // Canada
  ca: "ca", canada: "ca",
  // United States
  us: "us", usa: "us", "united states": "us", "united states of america": "us",
  // United Kingdom
  gb: "gb", uk: "gb", "united kingdom": "gb", "great britain": "gb",
  // Australia
  au: "au", australia: "au",
  // New Zealand
  nz: "nz", "new zealand": "nz",
  // Mexico
  mx: "mx", mexico: "mx",
  // France
  fr: "fr", france: "fr",
  // Germany
  de: "de", germany: "de",
  // Japan
  jp: "jp", japan: "jp",
  // Ireland
  ie: "ie", ireland: "ie",
};

/** Human-readable name for display, keyed by canonical ISO-2. */
const COUNTRY_NAMES: Record<string, string> = {
  ca: "Canada",
  us: "United States",
  gb: "United Kingdom",
  au: "Australia",
  nz: "New Zealand",
  mx: "Mexico",
  fr: "France",
  de: "Germany",
  jp: "Japan",
  ie: "Ireland",
};

/** Returns a canonical ISO-2 key for comparison, or the lowercased input if unknown. */
function normalizeCountry(value: string): string {
  const key = value.trim().toLowerCase();
  return COUNTRY_ALIASES[key] ?? key;
}

/** Returns the reviewer-facing display name for a country value. */
function displayCountry(value: string): string {
  const canonical = normalizeCountry(value);
  return COUNTRY_NAMES[canonical] ?? value;
}

// ── IP geolocation ────────────────────────────────────────────────────────────

export type GeoResult =
  | { ok: true; city: string; region: string; country: string; lat: number; lon: number }
  | { ok: false };

/** Returns false for private/loopback IPs that ip-api cannot resolve. */
function isPrivateIp(ip: string): boolean {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|localhost$)/i.test(ip);
}

export async function geolocateIp(ip: string): Promise<GeoResult> {
  if (!ip || isPrivateIp(ip)) return { ok: false };
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,lat,lon`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (data.status !== "success") return { ok: false };
    return {
      ok: true,
      city: data.city ?? "",
      region: data.regionName ?? "",
      country: data.country ?? "",
      lat: data.lat,
      lon: data.lon,
    };
  } catch {
    return { ok: false };
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function ipGeoSignal(
  ip: string | null | undefined,
  venueLat: number | null | undefined,
  venueLng: number | null | undefined,
  venueCountry: string | null | undefined
): Promise<TrustSignal> {
  if (!ip) {
    return {
      key: "ip",
      label: "IP geolocation",
      status: "neutral",
      detail: "No IP captured with this claim.",
    };
  }

  const geo = await geolocateIp(ip);

  if (!geo.ok) {
    return {
      key: "ip",
      label: "IP geolocation",
      status: "neutral",
      detail: `Submitted from ${ip}. Location could not be resolved (private, local, or unrecognised IP).`,
    };
  }

  const locationStr = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");

  if (venueLat == null || venueLng == null) {
    return {
      key: "ip",
      label: "IP geolocation",
      status: "neutral",
      detail: `${ip} → ${locationStr}. Venue coordinates not on file; distance check skipped.`,
    };
  }

  const distKm = haversineKm(venueLat, venueLng, geo.lat, geo.lon);
  const distStr = distKm < 1 ? "<1 km" : `~${Math.round(distKm).toLocaleString()} km`;

  const differentCountry =
    venueCountry &&
    geo.country &&
    normalizeCountry(geo.country) !== normalizeCountry(venueCountry);

  let status: SignalStatus;
  let tier: string;

  if (differentCountry) {
    status = "warning";
    tier = "Different country";
  } else if (distKm <= 25) {
    status = "positive";
    tier = "Nearby";
  } else if (distKm <= 100) {
    status = "neutral";
    tier = "Plausible distance";
  } else {
    status = "warning";
    tier = "Far";
  }

  const detail = differentCountry
    ? `Strong caution — IP in ${displayCountry(geo.country)}, venue is in ${displayCountry(venueCountry!)}. ${locationStr}, ${distStr} from venue. (IP: ${ip})`
    : `${tier} — ${locationStr}, ${distStr} from venue. (IP: ${ip})`;

  return { key: "ip", label: "IP geolocation", status, detail };
}

function priorClaimsSignal(priorCount: number): TrustSignal {
  if (priorCount === 0) {
    return {
      key: "prior_claims",
      label: "Prior claims",
      status: "positive",
      detail: "No prior claims for this venue.",
    };
  }
  if (priorCount === 1) {
    return {
      key: "prior_claims",
      label: "Prior claims",
      status: "warning",
      detail: "1 prior claim exists for this venue.",
    };
  }
  return {
    key: "prior_claims",
    label: "Prior claims",
    status: "negative",
    detail: `${priorCount} prior claims exist for this venue.`,
  };
}

// ── Main export ──────────────────────────────────────────────────────────────

export type ClaimForSignals = {
  email: string;
  phone: string | null | undefined;
  position: string;
  ip_address: string | null | undefined;
  venue: {
    website_url: string | null | undefined;
    phone: string | null | undefined;
    lat: number | null | undefined;
    lng: number | null | undefined;
    country: string | null | undefined;
  } | null;
  prior_claim_count: number;
};

export async function computeTrustSignals(claim: ClaimForSignals): Promise<TrustSignal[]> {
  const emailDomain = extractEmailDomain(claim.email);
  const isPublic = isPublicEmailDomain(emailDomain);

  const ipSignal = await ipGeoSignal(
    claim.ip_address,
    claim.venue?.lat,
    claim.venue?.lng,
    claim.venue?.country
  );

  return [
    emailDomainSignal(claim.email, claim.venue?.website_url, emailDomain, isPublic),
    publicEmailSignal(emailDomain, isPublic),
    roleSignal(claim.position),
    phoneSignal(claim.phone, claim.venue?.phone),
    ipSignal,
    priorClaimsSignal(claim.prior_claim_count),
  ];
}
