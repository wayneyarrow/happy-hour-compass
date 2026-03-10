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
  claimantEmail: string,
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

function ipSignal(ip: string | null | undefined): TrustSignal {
  return {
    key: "ip",
    label: "IP address",
    status: "neutral",
    detail: ip
      ? `Submitted from ${ip}. Geolocation check not yet enabled.`
      : "No IP captured. Geolocation check not yet enabled.",
  };
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
  } | null;
  prior_claim_count: number;
};

export function computeTrustSignals(claim: ClaimForSignals): TrustSignal[] {
  const emailDomain = extractEmailDomain(claim.email);
  const isPublic = isPublicEmailDomain(emailDomain);

  return [
    emailDomainSignal(claim.email, claim.venue?.website_url, emailDomain, isPublic),
    publicEmailSignal(emailDomain, isPublic),
    roleSignal(claim.position),
    phoneSignal(claim.phone, claim.venue?.phone),
    ipSignal(claim.ip_address),
    priorClaimsSignal(claim.prior_claim_count),
  ];
}
