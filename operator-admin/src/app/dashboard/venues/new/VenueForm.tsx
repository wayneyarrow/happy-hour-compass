"use client";

import { useActionState } from "react";
import { createVenueAction, type CreateVenueState } from "./actions";
import VenueFormFields from "../_shared/VenueFormFields";

const initialState: CreateVenueState = {};

export default function VenueForm() {
  const [state, formAction, isPending] = useActionState(
    createVenueAction,
    initialState
  );

  return (
    <form action={formAction} className="space-y-5">
      <VenueFormFields
        errors={state.errors}
        defaultValues={state.values}
        isPending={isPending}
        submitLabel="Create venue"
        pendingLabel="Creating…"
      />
    </form>
  );
}
