"use client";

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { updateAccountProfile } from "./actions";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

type Props = {
  email: string;
  displayName: string | null;
  marketingConsent: boolean;
};

export default function AccountProfileForm({
  email,
  displayName,
  marketingConsent,
}: Props) {
  const router = useRouter();
  const marketingRef = useRef<HTMLInputElement>(null);

  const [state, formAction, isPending] = useActionState(updateAccountProfile, {});

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  // Hidden field carries the marketing consent value since checkboxes omit their
  // value from FormData when unchecked — this ensures we always receive it.
  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const hidden = form.querySelector<HTMLInputElement>(
      'input[name="marketing_consent"]'
    );
    if (hidden && marketingRef.current) {
      hidden.value = marketingRef.current.checked ? "true" : "false";
    }
  }

  return (
    <div className="space-y-8">
      {/* Profile section */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Profile
        </h2>

        <form action={formAction} onSubmit={handleFormSubmit} className="space-y-4">
          {/* Hidden field for marketing consent boolean */}
          <input
            type="hidden"
            name="marketing_consent"
            defaultValue={marketingConsent ? "true" : "false"}
          />

          {/* Name */}
          <div>
            <label
              htmlFor="display_name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Name{" "}
              <span className="text-gray-400 font-normal text-xs">(optional)</span>
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              autoComplete="name"
              defaultValue={displayName ?? ""}
              placeholder="Your name"
              className={INPUT_CLASS}
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 bg-gray-50 cursor-default select-all"
            />
            <p className="mt-1 text-xs text-gray-400">
              We don’t currently support changing your email. Contact us if you need to update it.
            </p>
          </div>

          {/* Marketing consent */}
          <div className="pt-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                ref={marketingRef}
                type="checkbox"
                defaultChecked={marketingConsent}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 cursor-pointer"
              />
              <span className="text-sm text-gray-600 leading-snug">
                Send me occasional Happy Hour Compass updates, recommendations, and
                special offers. I can unsubscribe anytime.
              </span>
            </label>
          </div>

          {state.error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {state.error}
            </div>
          )}

          {state.success && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Changes saved.
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="py-2 px-5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>

      {/* Password section */}
      <section className="border-t border-gray-100 pt-8">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Password
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          Use a strong, unique password for your account.
        </p>
        <Link
          href="/account/forgot-password"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
        >
          Change password →
        </Link>
      </section>

      {/* Legal links */}
      <section className="border-t border-gray-100 pt-8">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Legal</h2>
        <div className="flex gap-4">
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            Privacy Policy
          </Link>
        </div>
      </section>

      {/* Sign out */}
      <section className="border-t border-gray-100 pt-8">
        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
        >
          Sign out
        </button>
      </section>

      {/* Delete account — placeholder for V1 */}
      <section className="border-t border-gray-100 pt-8">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Delete account
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          Permanently delete your account and all associated data.
        </p>
        <button
          type="button"
          disabled
          title="Account deletion coming soon — contact support in the meantime"
          className="py-2 px-4 border border-red-200 text-red-400 text-sm font-medium rounded-lg cursor-not-allowed opacity-60"
        >
          Delete my account
        </button>
        <p className="mt-2 text-xs text-gray-400">
          Account deletion is coming soon. In the meantime, contact us to remove
          your data.
        </p>
      </section>
    </div>
  );
}
