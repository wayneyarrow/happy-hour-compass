"use client";

import { useActionState } from "react";
import {
  updatePaymentTypesAction,
  PAYMENT_OPTIONS,
  type PaymentTypesState,
} from "./actions";

type Props = {
  venueId: string;
  initialPaymentTypes: string[];
};

const initialState: PaymentTypesState = {};

export default function PaymentTypesForm({
  venueId,
  initialPaymentTypes,
}: Props) {
  const boundAction = updatePaymentTypesAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );

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
              defaultChecked={initialPaymentTypes.includes(type)}
              disabled={isPending}
              className="h-4 w-4 rounded border-gray-300 accent-amber-500"
            />
            {type}
          </label>
        ))}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Saving…" : "Save payment types"}
      </button>
    </form>
  );
}
