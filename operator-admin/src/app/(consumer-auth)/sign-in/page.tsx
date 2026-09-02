"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import { touchConsumerProfile } from "./actions";
import { resolveCurrentUserAccess } from "@/lib/postAuthAccess";
import { resolveLoginOutcome, type LoginOutcome } from "@/lib/accessOutcome";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only once authentication has actually succeeded but this identity
  // has no Consumer access — see resolveLoginOutcome (src/lib/accessOutcome.ts).
  // Consumer and Operator share one Auth identity store, so a correct
  // password is not by itself enough to grant Consumer access.
  const [wrongContext, setWrongContext] = useState<LoginOutcome | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setWrongContext(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    const access = await resolveCurrentUserAccess();
    const outcome = resolveLoginOutcome("consumer", access);
    setLoading(false);

    if (outcome !== "granted") {
      setWrongContext(outcome);
      return;
    }

    await touchConsumerProfile().catch(() => {});

    const dest = nextPath.startsWith("/") ? nextPath : "/";
    router.push(dest);
    router.refresh();
  }

  if (wrongContext === "wrong-context") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">This is a Business account</h1>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          {email} is set up as a Happy Hour Compass Business account for
          managing a venue, not a Consumer account for discovering happy
          hours. Continue to Business Admin instead.
        </p>
        <Link
          href="/admin/home"
          className="inline-flex w-full items-center justify-center py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors"
        >
          Continue to Business Admin →
        </Link>
      </div>
    );
  }

  if (wrongContext === "no-account") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">No Consumer account found</h1>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          We couldn&rsquo;t find a Consumer account for {email}.
        </p>
        <Link
          href="/sign-up"
          className="text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          Create one free →
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sign in to your Happy Hour Compass account</h1>
        <p className="text-sm text-gray-500 mt-1">
          For discovering and saving happy hours &amp; events — not for
          managing a venue.{" "}
          <Link href="/login" className="text-amber-600 hover:text-amber-700 font-medium">
            Business Login →
          </Link>
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
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={INPUT_CLASS}
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
            <Link
              href="/account/forgot-password"
              className="text-xs text-amber-600 hover:text-amber-700 font-medium"
            >
              Forgot your password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={INPUT_CLASS}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Don&apos;t have an account?{" "}
        <Link
          href="/sign-up"
          className="text-amber-600 hover:text-amber-700 font-medium"
        >
          Create one free
        </Link>
      </p>
    </div>
  );
}
