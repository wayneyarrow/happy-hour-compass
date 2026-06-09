"use client";

import { useState, useTransition } from "react";
import { createPortalSessionAction } from "./stripeActions";

export default function ManageBillingButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError]            = useState<string | null>(null);

  function handleClick() {
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
        disabled={isPending}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Opening…" : "Manage Billing"}
      </button>
      {error && (
        <p className="text-xs text-red-600 text-right max-w-[220px]">{error}</p>
      )}
    </div>
  );
}
