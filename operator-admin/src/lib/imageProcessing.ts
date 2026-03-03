/**
 * Client-side image resizing and compression before Supabase upload.
 *
 * ── Display audit ────────────────────────────────────────────────────────────
 * Consumer app (index.html):
 *   • Venue list cards:    72 × 72 px square, <img> object-fit:cover (inline style)
 *   • Venue detail hero:   full-width, CSS background-size:cover
 *   • Event detail hero:   same as venue detail; currently uses venue image fallback
 *   The consumer app does not yet render live DB images — it uses static
 *   category-based placeholders. All display contexts use cover/fill, so
 *   arbitrary aspect ratios are fully supported.
 *
 * Operator admin:
 *   • VenueImagesSection:  Tailwind aspect-[4/3] thumbnail grid, object-cover
 *   • EventForm thumbnail: w-24 h-24 (96 × 96 px) square, object-cover
 *
 * Conclusion: aspect ratio is PRESERVED. Only the max width is capped (1600 px).
 * CSS object-cover / background-size:cover handle framing at all display sizes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ImageProcessOptions = {
  /** Maximum output width in pixels. Height scales proportionally. */
  maxWidth: number;
  /** Maximum acceptable output file size in bytes. */
  maxSizeBytes: number;
  /** MIME type for the output. Defaults to 'image/jpeg'. */
  outputType?: "image/jpeg" | "image/webp";
  /** Canvas quality (0–1). Defaults to 0.8. */
  quality?: number;
};

// ── Errors ────────────────────────────────────────────────────────────────────

/** Thrown when the image cannot be reduced below `maxSizeBytes`. */
export class ImageTooLargeError extends Error {
  constructor() {
    super("IMAGE_TOO_LARGE_AFTER_COMPRESSION");
    this.name = "ImageTooLargeError";
  }
}

/** Thrown when the file is not a recognised image MIME type. */
export class InvalidImageTypeError extends Error {
  constructor() {
    super("INVALID_IMAGE_TYPE");
    this.name = "InvalidImageTypeError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("CANVAS_TO_BLOB_FAILED"));
      },
      type,
      quality
    );
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Resizes and compresses an image file client-side before upload.
 *
 * - Validates MIME type (must start with "image/").
 * - Preserves aspect ratio; scales down only if width > maxWidth.
 * - Encodes to `outputType` (default JPEG) at `quality` (default 0.8).
 * - If the result exceeds `maxSizeBytes`, retries once at quality 0.6.
 * - Throws `ImageTooLargeError` if still too large after both attempts.
 *
 * Must run in a browser context (requires `document` and `createImageBitmap`).
 */
export async function processImageFile(
  file: File,
  options: ImageProcessOptions
): Promise<Blob> {
  const {
    maxWidth,
    maxSizeBytes,
    outputType = "image/jpeg",
    quality = 0.8,
  } = options;

  if (!file.type.startsWith("image/")) {
    throw new InvalidImageTypeError();
  }

  // Decode the image into a bitmap (browser API, no external deps).
  const bitmap = await createImageBitmap(file);

  // Scale down if needed — never upscale.
  let outWidth = bitmap.width;
  let outHeight = bitmap.height;
  if (outWidth > maxWidth) {
    outHeight = Math.round((outHeight * maxWidth) / outWidth);
    outWidth = maxWidth;
  }

  // Draw onto an off-screen canvas.
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_NOT_SUPPORTED");
  ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);
  bitmap.close();

  // First encode attempt.
  const primary = await canvasToBlob(canvas, outputType, quality);
  if (primary.size <= maxSizeBytes) return primary;

  // Fallback at lower quality.
  const fallback = await canvasToBlob(canvas, outputType, 0.6);
  if (fallback.size <= maxSizeBytes) return fallback;

  throw new ImageTooLargeError();
}
