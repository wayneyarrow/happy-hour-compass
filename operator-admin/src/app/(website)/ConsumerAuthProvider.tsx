"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/browser";
import { mergeSavedItems } from "@/lib/consumer/savedSync";

// ─── Context ──────────────────────────────────────────────────────────────────

type ConsumerAuthContextValue = {
  consumerId: string | null;
};

const ConsumerAuthContext = createContext<ConsumerAuthContextValue>({
  consumerId: null,
});

export function useConsumerId(): string | null {
  return useContext(ConsumerAuthContext).consumerId;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const SYNC_KEY = "hhc_sync_done";

/**
 * Provides consumer auth state to all client components in the (website) tree.
 *
 * On mount (or when consumerId becomes non-null after sign-in), runs a
 * once-per-session merge of localStorage saves ↔ DB saves. The session guard
 * stores the consumerId in sessionStorage so:
 *   - Same user navigating between pages: no re-sync.
 *   - Different user in same tab (logout + re-login): re-sync triggered.
 *   - New tab / browser restart: sessionStorage cleared, fresh sync.
 */
export function ConsumerAuthProvider({
  consumerId,
  children,
}: {
  consumerId: string | null;
  children: ReactNode;
}) {
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!consumerId) return;
    if (syncedRef.current) return;

    try {
      if (sessionStorage.getItem(SYNC_KEY) === consumerId) return;
    } catch {
      // sessionStorage unavailable — proceed with sync anyway.
    }

    syncedRef.current = true;
    const supabase = createClient();

    mergeSavedItems(supabase, consumerId).then(() => {
      try {
        sessionStorage.setItem(SYNC_KEY, consumerId);
      } catch {
        // Fail silently — sync still succeeded; it will just re-run on next page load.
      }
    });
  }, [consumerId]);

  return (
    <ConsumerAuthContext.Provider value={{ consumerId }}>
      {children}
    </ConsumerAuthContext.Provider>
  );
}
