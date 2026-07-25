type Props = {
  /** Element id — pass as the input's `aria-describedby` so assistive tech
   * associates this message with the field it belongs to. */
  id: string;
  message?: string;
};

/**
 * Shared field-level validation error message. `role="alert"` means
 * screen readers announce the text as soon as it appears (e.g. after a
 * server action returns field errors), without requiring focus to move.
 */
export function FieldError({ id, message }: Props) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-red-600">
      {message}
    </p>
  );
}
