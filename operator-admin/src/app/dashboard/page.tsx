import { redirect } from "next/navigation";

// Deprecated route — kept so /dashboard links don't 404.
// Redirects to the operator home (readiness center).
export default function DashboardPage() {
  redirect("/admin/home");
}
