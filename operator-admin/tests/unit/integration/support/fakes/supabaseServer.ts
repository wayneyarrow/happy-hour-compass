// Boundary fake for "@/lib/supabase/server" — the Supabase project itself.
import { fakeAdminClient, fakeSessionClient } from "../world";

export async function createClient() {
  return fakeSessionClient();
}
export function createAdminClient() {
  return fakeAdminClient();
}
