"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { resolveCurrentUserAccess } from "@/lib/postAuthAccess";
import { resolveLoginOutcome, type LoginOutcome } from "@/lib/accessOutcome";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Set only once authentication has actually succeeded but this identity
  // has no Business/Operator access — see resolveLoginOutcome
  // (src/lib/accessOutcome.ts). Consumer and Operator share one Auth
  // identity store, so a correct password is not by itself enough to grant
  // Operator Admin access.
  const [wrongContext, setWrongContext] = useState<LoginOutcome | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setWrongContext(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }

    const access = await resolveCurrentUserAccess();
    const outcome = resolveLoginOutcome("business", access);
    setLoading(false);

    if (outcome !== "granted") {
      setWrongContext(outcome);
      return;
    }

    router.push("/admin/home");
    router.refresh();
  }

  if (wrongContext) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Image
              src="/logo.png"
              alt="Happy Hour Compass"
              width={80}
              height={80}
              className="rounded-xl"
            />
          </div>
          <div className="bg-white p-8 rounded-xl shadow-md text-center">
            {wrongContext === "wrong-context" ? (
              <>
                <h1 className="text-xl font-bold text-gray-900 mb-2">This is a Consumer account</h1>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  {email} is set up as a Happy Hour Compass Consumer account
                  for discovering happy hours, not a Business account. This
                  email isn&rsquo;t associated with a venue on Happy Hour
                  Compass.
                </p>
                <a
                  href="/business"
                  className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                >
                  Learn about listing your business →
                </a>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-gray-900 mb-2">No Business account found</h1>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  We couldn&rsquo;t find a Business account for {email}.
                  If you manage a venue on Happy Hour Compass, contact{" "}
                  <a href="mailto:hello@happyhourcompass.com" className="underline">
                    hello@happyhourcompass.com
                  </a>
                  .
                </p>
                <a
                  href="/business"
                  className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                >
                  Learn about listing your business →
                </a>
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo — centered above the card */}
        <div className="flex justify-center mb-8">
          <Image
            src="/logo.png"
            alt="Happy Hour Compass"
            width={80}
            height={80}
            className="rounded-xl"
          />
        </div>

        <div className="bg-white p-8 rounded-xl shadow-md">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Happy Hour Compass
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Business Login — for restaurant, bar &amp; venue operators.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <a
                href="/forgot-password"
                className="text-xs text-amber-600 hover:text-amber-700 font-medium"
              >
                Forgot your password?
              </a>
            </div>
            <PasswordInput
              id="password"
              required
              minLength={6}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>

          {errorMsg && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Please wait…" : "Sign In"}
          </button>
        </form>

        <p className="mt-6 text-xs text-gray-400 text-center leading-relaxed">
          New to Happy Hour Compass?{" "}
          <a href="/claim-your-venue" className="underline hover:text-gray-600 transition-colors">
            Claim your venue
          </a>{" "}
          or find out how to{" "}
          <a href="/business" className="underline hover:text-gray-600 transition-colors">
            add your business
          </a>
          .
        </p>
        <p className="mt-2 text-xs text-gray-400 text-center leading-relaxed">
          Looking for your personal account?{" "}
          <a href="/sign-in" className="underline hover:text-gray-600 transition-colors">
            Consumer Sign In
          </a>{" "}
          →
        </p>
        </div>{/* end card */}
      </div>{/* end max-w-md wrapper */}
    </main>
  );
}
