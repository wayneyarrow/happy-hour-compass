// Boundary fake for "@/lib/turnstile": Cloudflare Siteverify is external.
// Everything else (constants, IP extraction) is the real module.
import { world } from "../world";
export * from "../../../../../src/lib/turnstile";

export async function verifyTurnstileToken(token: string | null | undefined) {
  return world.turnstileOk && token ? { success: true as const } : { success: false as const, reason: "failed" as const };
}
