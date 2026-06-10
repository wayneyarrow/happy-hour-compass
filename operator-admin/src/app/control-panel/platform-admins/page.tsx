import { createClient } from "@/lib/supabase/server";
import { getPlatformAdmins } from "@/lib/platformAdmins";
import PlatformAdminsClient from "./PlatformAdminsClient";

export const metadata = { title: "Platform Admins" };
export const dynamic = "force-dynamic";

export default async function PlatformAdminsPage() {
  const [supabase, admins] = await Promise.all([
    createClient(),
    getPlatformAdmins(),
  ]);

  const { data: { user } } = await supabase.auth.getUser();
  const currentEmail = user?.email ?? "";

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Platform Admins</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage who has access to this Control Panel.
          All platform admins have full access.
        </p>
      </div>

      <PlatformAdminsClient admins={admins} currentEmail={currentEmail} />
    </div>
  );
}
