import { redirect } from "next/navigation";

// /admin → /admin/home (growth & readiness center is the primary entry point)
export default function AdminIndexPage() {
  redirect("/admin/home");
}
