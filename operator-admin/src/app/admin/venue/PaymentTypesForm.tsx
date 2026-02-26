"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updatePaymentTypesAction } from "./actions";
import { PAYMENT_OPTIONS, type PaymentTypesState } from "./types";

type Props = {
  venueId: string;
  initialPaymentTypes: string[];
};

const initialState: PaymentTypesState = {};

export default function PaymentTypesForm({
  venueId,
  initialPaymentTypes,
}: Props) {
  const router = useRouter();
  const boundAction = updatePaymentTypesAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );
  const [saved, setSaved] = useState(false);

  // Controlled state so checkboxes reliably reflect the stored values after
  // router.refresh() causes the parent (server component) to send fresh props.
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialPaymentTypes)
  );

  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [state.success, router]);

  function toggle(type: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {PAYMENT_OPTIONS.map((type) => (
          <label
            key={type}
            className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none"
          >
            <input
              type="checkbox"
              name={`payment_${type}`}
              checked={selected.has(type)}
              onChange={() => toggle(type)}
              disabled={isPending}
              className="h-4 w-4 rounded border-gray-300 accent-amber-500"
            />
            {type}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save payment types"}
        </button>
        {saved && (
          <span className="text-sm font-medium text-green-600" role="status">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
