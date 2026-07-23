import { redirect } from "next/navigation";

// Deprecated route — kept so old /dashboard/venues/new links don't 404.
// Venue creation now happens on /admin/venue, which is gated the same way
// this page was; this redirect just retires the legacy duplicate surface.
export default function NewVenuePage() {
  redirect("/admin/venue");
}
