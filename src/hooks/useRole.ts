import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reads the current user's roles from public.user_roles.
 * - isAdmin: user has 'admin' or 'superadmin'
 * - isStaff: authenticated but NOT admin (default). Restricts aggregate $ views.
 * RLS "Users can view own roles" scopes results to the current user.
 */
export function useRole() {
  const q = useQuery({
    queryKey: ["user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role");
      if (error) {
        console.warn("user_roles query failed:", error);
        return [] as { role: string }[];
      }
      return (data ?? []) as { role: string }[];
    },
    staleTime: 5 * 60_000,
  });

  const roles = new Set((q.data ?? []).map((r) => r.role));
  const isAdmin = roles.has("admin") || roles.has("superadmin");
  return {
    isLoading: q.isLoading,
    roles,
    isAdmin,
    isStaff: !isAdmin,
  };
}
