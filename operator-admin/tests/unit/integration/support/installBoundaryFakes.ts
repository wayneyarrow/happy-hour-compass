/**
 * Routes ONLY the external-boundary modules to in-process fakes (see
 * world.ts), so the real application orchestration can run end to end in a
 * unit-test process. Must be imported before any application module.
 *
 * The app compiles to CommonJS under tsx, so this wraps the CJS resolver
 * (Module._resolveFilename) — on top of tsx's own "@/..." alias handling.
 * Requests made FROM the fakes directory are never redirected, so a fake
 * can re-export the real module it wraps.
 */
import Module from "node:module";
import { join } from "node:path";
import React from "react";

const FAKES = join(__dirname, "fakes");
const MAP: Record<string, string> = {
  "@/lib/supabase/server": join(FAKES, "supabaseServer.ts"),
  "next/headers": join(FAKES, "nextHeaders.ts"),
  "@/lib/turnstile": join(FAKES, "turnstile.ts"),
  "@/lib/slack": join(FAKES, "slack.ts"),
  resend: join(FAKES, "resend.ts"),
  "@/lib/google/placesMatch": join(FAKES, "placesMatch.ts"),
  "next/navigation": join(FAKES, "nextNavigation.ts"),
  "next/image": join(FAKES, "nextImage.tsx"),
  "next/link": join(FAKES, "nextLink.tsx"),
  "next/cache": join(FAKES, "nextCache.ts"),
};

type Resolver = (request: string, parent?: { filename?: string | null }, ...rest: unknown[]) => string;
const M = Module as unknown as { _resolveFilename: Resolver };
const original = M._resolveFilename;
M._resolveFilename = function (request, parent, ...rest) {
  const fake = MAP[request];
  if (fake && !(parent?.filename ?? "").startsWith(FAKES)) return fake;
  return original.call(this, request, parent, ...rest);
};

// tsx compiles JSX in classic mode under this tsconfig ("jsx": "preserve").
(globalThis as { React?: typeof React }).React = React;
