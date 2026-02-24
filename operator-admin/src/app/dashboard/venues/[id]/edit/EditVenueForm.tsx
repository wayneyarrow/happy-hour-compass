"use client";

import { useActionState } from "react";
import { updateVenueAction, type UpdateVenueState } from "./actions";
import VenueFormFields from "../../_shared/VenueFormFields";
import type { VenueFormValues } from "../../_shared/types";

type Props = {
  venueId: string;
  initialValues: VenueFormValues;
};

const initialState: UpdateVenueState = {};

export default function EditVenueForm({ venueId, initialValues }: Props) {
  // Bind venueId into the action so it arrives as a typed argument,
  // never from FormData (prevents client-side ID substitution).
  const boundAction = updateVenueAction.bind(null, venueId);

  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );

  // After a failed submit, show the values the user last typed.
  // On first render (state.values is undefined), show the DB values.
  const activeValues = state.values ?? initialValues;

  return (
    <form action={formAction} className="space-y-5">
      <VenueFormFields
        errors={state.errors}
        defaultValues={activeValues}
        isPending={isPending}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </form>
  );
}
