import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { simplePackageClientIds } from "@/lib/simple-package-review";

/** Existence only: scheduling badges must not depend on legacy package fields or money reads. */
export function useSimplePackageClientIds() {
  return useQuery({
    queryKey: ["simple-dues", "package-client-ids"],
    queryFn: async () => {
      const rows: { client_id: string; deleted_at: string | null }[] = [];
      for (let from = 0; ; from += 500) {
        const result = await supabase.from("simple_packages").select("client_id,deleted_at").is("deleted_at", null).order("id").range(from, from + 499);
        if (result.error) throw result.error;
        rows.push(...result.data ?? []);
        if ((result.data?.length ?? 0) < 500) break;
      }
      return simplePackageClientIds(rows);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}