import { redirect } from "next/navigation";

// /admin → /admin/venue (the primary working section)
export default function AdminIndexPage() {
  redirect("/admin/venue");
}
