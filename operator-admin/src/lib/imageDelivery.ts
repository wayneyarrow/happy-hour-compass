// Which image sources may go through next/image (Vercel Image Optimization).
//
// Remote optimization is restricted to the one public Supabase Storage bucket
// every upload flow writes to ("venue-images": venue, event, daily-special and
// guide hero photos). next.config.ts builds its `images.remotePatterns` entry
// from these same constants, so the allowlist and this check can't drift.
//
// Anything else (another host, another bucket, a query string, a data: URL)
// is rendered with `unoptimized`, i.e. exactly the original URL, as before.
// A URL outside remotePatterns would otherwise be rejected by /_next/image and
// show as a broken image.

export const SUPABASE_IMAGE_HOST = "juphyhxdmcvseeufbiay.supabase.co";
export const SUPABASE_IMAGE_PATH_PREFIX = "/storage/v1/object/public/venue-images/";

// WebP quality for venue photos (cards, gallery, thumbnails): the lowest value
// with no visible change from the original at displayed size. 60 softened fine
// texture; see docs/performance/PHASE3_IMAGE_DELIVERY.md.
export const PHOTO_QUALITY = 70;

// Committed placeholder library (public/images/...).
const LOCAL_IMAGE_PATH_PREFIX = "/images/";

export function isOptimizableImageSrc(src: string): boolean {
  if (src.startsWith(LOCAL_IMAGE_PATH_PREFIX)) return true;
  try {
    const url = new URL(src);
    return (
      url.protocol === "https:" &&
      url.hostname === SUPABASE_IMAGE_HOST &&
      url.port === "" &&
      url.pathname.startsWith(SUPABASE_IMAGE_PATH_PREFIX) &&
      url.search === ""
    );
  } catch {
    return false;
  }
}
