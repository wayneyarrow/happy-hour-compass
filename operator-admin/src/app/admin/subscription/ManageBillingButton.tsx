"use client";

import { useState, useTransition } from "react";
import { createPortalSessionAction } from "./stripeActions";

export default function ManageBillingButton({ isOwner }: { isOwner: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError]            = useState<string | null>(null);

  function handleClick() {
    if (!isOwner) return;
    setError(null);
    startTransition(async () => {
      const result = await createPortalSessionAction();
      if (result.ok && result.url) {
        window.location.href = result.url;
      } else {
        setError(result.error ?? "Could not open billing portal. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || !isOwner}
        title={!isOwner ? "Only the account owner can manage billing." : undefined}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Opening…" : "Manage Billing"}
      </button>
      {!isOwner && (
        <p className="text-xs text-gray-400 text-right max-w-[220px]">
          Only the account owner can manage billing.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 text-right max-w-[220px]">{error}</p>
      )}
    </div>
  );
}
