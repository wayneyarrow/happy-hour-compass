import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AccountProfileForm from "./AccountProfileForm";

export const metadata: Metadata = { title: "My Account", robots: { index: false } };

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/account");
  }

  const { data: profile } = await supabase
    .from("consumer_profiles")
    .select("display_name, first_name, last_name, email, marketing_consent")
    .eq("id", user.id)
    .maybeSingle();

  // No consumer_profiles row means this is an operator or an unverified user —
  // never auto-create a profile; only intentional consumer sign-up does that.
  if (!profile) {
    redirect("/sign-in?next=/account");
  }

  // display_name is still used here only for the page greeting — the
  // editable form below uses the structured fields directly.
  const displayName = profile.display_name ?? null;
  const firstName = profile.first_name ?? null;
  const lastName = profile.last_name ?? null;
  const email = profile.email;
  const marketingConsent = profile.marketing_consent ?? false;

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12 lg:py-16">
      {/* Page header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900">My Account</h1>
        {displayName && (
          <p className="mt-1 text-gray-500">Welcome back, {displayName}.</p>
        )}
      </div>

      {/* Content — single column, max readable width */}
      <div className="max-w-lg">
        <AccountProfileForm
          email={email}
          firstName={firstName}
          lastName={lastName}
          marketingConsent={marketingConsent}
        />
      </div>
    </div>
  );
}
