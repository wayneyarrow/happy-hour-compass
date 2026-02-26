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
