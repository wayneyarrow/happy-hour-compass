import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/welcome");
  }

  const { data: profile } = await supabase
    .from("consumer_profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/sign-in?next=/welcome");
  }

  const firstName = profile.display_name?.split(" ")[0] ?? null;

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-8">
          <svg
            className="w-8 h-8 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
          Welcome to Happy Hour Compass{firstName ? `, ${firstName}` : ""}
        </h1>

        {/* Subtitle */}
        <p className="mt-3 text-lg text-amber-600 font-medium">
          Your free account is ready.
        </p>

        {/* Body */}
        <p className="mt-4 text-base text-gray-500 leading-relaxed">
          You can now save your favourite happy hours and events across devices.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-full text-sm transition-colors"
          >
            Start exploring happy hours
          </Link>
          <Link
            href="/account"
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-full text-sm transition-colors"
          >
            My Account
          </Link>
        </div>
      </div>
    </div>
  );
}
