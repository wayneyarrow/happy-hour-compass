import { redirect } from "next/navigation";

// Root path redirects to /dashboard.
// Middleware will redirect to /login if the user is not authenticated.
export default function Home() {
  redirect("/dashboard");
}
