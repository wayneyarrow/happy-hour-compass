import { redirect } from "next/navigation";

// The admin shell at /admin/venue is now the primary interface.
// This file is kept intact so the /dashboard route continues to resolve,
// but it immediately redirects to the new admin section.
export default function DashboardPage() {
  redirect("/admin/venue");
}
