// State types shared between server actions (actions.ts) and client form
// components. Kept separate because "use server" modules may only export
// async functions — not types or plain-object constants.

export type TaglineState = {
  success?: boolean;
  errors?: { form?: string; hh_tagline?: string };
  values?: { hh_tagline: string };
};

export type HhTimesState = {
  success?: boolean;
  errors?: { form?: string };
  /**
   * True when this save left the venue with no qualifying Happy Hour slot on
   * any day and it was automatically unpublished as a result (see the
   * auto-unpublish block in updateHhTimesAction). Optional/undefined for
   * every other outcome, including the Control Panel's actionOverride.
   */
  venueUnpublished?: boolean;
};

/** A single food or drink special item. */
export type HhItem = {
  name: string;
  price?: string;
  notes?: string;
};

export type SpecialsState = {
  success?: boolean;
  errors?: { form?: string };
};
