import { redirect } from "next/navigation";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";

export default async function ControlPanelRoot() {
  // Authorize before any data read or render — see requireControlPanelAdmin.ts.
  await requireControlPanelAdmin();

  redirect("/control-panel/dashboard");
}
