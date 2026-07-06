import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * beforeLoad guard for admin-only routes. Runs client-side (parent
 * `_authenticated` layout is ssr:false), redirects non-admins home.
 */
export async function requireAdmin() {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) throw redirect({ to: "/auth" });
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .in("role", ["admin", "superadmin"]);
  if (!data || data.length === 0) {
    throw redirect({ to: "/" });
  }
}
