"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

/**
 * WelcomeGate — opening screen logic ported from original index.html.
 *
 * First visit (hhc_has_launched not set in localStorage):
 *   Shows the home screen: logo (180×180) + tagline + "Explore happy hours" CTA.
 *   On CTA click, sets hhc_has_launched = 'true' and renders children.
 *
 * Subsequent visits (hhc_has_launched already set):
 *   Shows the splash screen: logo (220×220) centred for 1.2 s, then
 *   fades out over 0.3 s (matching .splash-screen.fade-out CSS transition),
 *   then renders children.
 *
 * Phase 'loading' (before localStorage is read on the client):
 *   Renders a blank white screen to prevent a flash of the underlying content.
 *
 * Storage key: 'hhc_has_launched' — mirrors original JS exactly.
 */

const STORAGE_KEY = "hhc_has_launched";

// Nav bar height approximation used to size the welcome screens so they
// visually fill the frame (matches original .screen { height: 100% }).
// Desktop phone frame = 812px; mobile = 100dvh.
const SCREEN_HEIGHT_CLASS =
  "min-h-[calc(100dvh-56px)] md:min-h-[756px]";

type Phase = "loading" | "home" | "splash" | "splash-fade" | "done";

type Props = {
  children: React.ReactNode;
};

export function WelcomeGate({ children }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const hasLaunched = localStorage.getItem(STORAGE_KEY);

    if (!hasLaunched) {
      // First launch — show home screen with CTA
      setPhase("home");
    } else {
      // Subsequent launch — brief splash then fade to content
      setPhase("splash");
      const fadeTimer = setTimeout(() => {
        setPhase("splash-fade");
        const doneTimer = setTimeout(() => {
          setPhase("done");
        }, 300); // matches original CSS transition: 0.3s
        return () => clearTimeout(doneTimer);
      }, 1200); // matches original: splash visible 1.2 s before fade begins
      return () => clearTimeout(fadeTimer);
    }
  }, []);

  function handleCta() {
    localStorage.setItem(STORAGE_KEY, "true");
    setPhase("done");
  }

  // Blank white screen — prevents flash of VenueDiscovery before localStorage read
  if (phase === "loading") {
    return <div className={`bg-white w-full ${SCREEN_HEIGHT_CLASS}`} />;
  }

  // Children — normal app content
  if (phase === "done") {
    return <>{children}</>;
  }

  // ── Home screen (first launch) ─────────────────────────────────────────────
  // Matches original .home-screen: white bg, flex column, items-center,
  // padding-top 120px, logo 180×180 with 32px bottom margin.
  if (phase === "home") {
    return (
      <div
        className={`bg-white w-full flex flex-col items-center ${SCREEN_HEIGHT_CLASS}`}
        style={{ paddingTop: 120 }}
      >
        {/* Logo — matches original .home-screen .splash-logo: 180×180 */}
        <Image
          src="/logo.png"
          alt="Happy Hour Compass"
          width={180}
          height={180}
          priority
          className="object-contain"
          style={{ marginBottom: 32 }}
        />

        {/* Tagline — matches original .home-tagline: 20px, #374151, 500, centred */}
        <p
          className="text-center font-medium px-6"
          style={{ fontSize: 20, color: "#374151", marginBottom: 48 }}
        >
          Your guide to local happy hours
        </p>

        {/* CTA — matches original .home-cta: orange, white text, 12px radius */}
        <button
          type="button"
          onClick={handleCta}
          className="text-white font-semibold rounded-xl cursor-pointer transition-colors"
          style={{
            background: "#f97316",
            padding: "16px 32px",
            fontSize: 16,
            borderRadius: 12,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "#ea580c")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "#f97316")
          }
        >
          Explore happy hours
        </button>
      </div>
    );
  }

  // ── Splash screen (subsequent launches) ───────────────────────────────────
  // Matches original .splash-screen: white bg, flex column, centred.
  // phase 'splash-fade' applies opacity-0 transition (matches .splash-screen.fade-out).
  return (
    <div
      className={`bg-white w-full flex items-center justify-center ${SCREEN_HEIGHT_CLASS} transition-opacity duration-300 ${
        phase === "splash-fade" ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Logo — matches original .splash-logo: 220×220 */}
      <Image
        src="/logo.png"
        alt="Happy Hour Compass"
        width={220}
        height={220}
        priority
        className="object-contain"
      />
    </div>
  );
}
