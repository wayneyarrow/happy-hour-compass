/**
 * Pure Storage URL parsing for Daily Special image cleanup — extracted out
 * of imageActions.ts specifically so it's directly unit-testable: a
 * "use server" file may only export async functions (Next.js requirement),
 * so this synchronous helper cannot live there itself.
 */

/**
 * Parses a public Storage URL into its bucket-relative object path — ONLY
 * when it actually matches the given bucket's public URL shape
 * (".../storage/v1/object/public/<bucket>/<path>"). Returns null for
 * anything else — an unparseable URL, a different bucket, or an
 * arbitrary/external URL — so a caller can never be tricked into deleting
 * something outside its own bucket.
 */
export function parseOwnedStoragePath(imageUrl: string, bucket: string): string | null {
  try {
    const urlObj = new URL(imageUrl);
    const match = urlObj.pathname.match(/\/public\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const [, matchedBucket, objectPath] = match;
    if (matchedBucket !== bucket) return null;
    return objectPath;
  } catch {
    return null;
  }
}
