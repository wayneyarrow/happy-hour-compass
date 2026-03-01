/**
 * Converts a string into a URL-safe slug.
 * e.g. "Tuesday Trivia Night!" → "tuesday-trivia-night"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
