import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { archiveUpdatePayload, decideArchive, type ArchiveDecision } from "./archive-eligibility";

type Ctx = { supabase: any; userId: string };

async function assertAdmin({ supabase, userId }: Ctx) {
  const [a, s] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
  ]);
  if (!a.data && !s.data) throw new Error("Only admins can archive or restore clients.");
}

async function evaluate(ctx: Ctx, clientId: string): Promise<ArchiveDecision> {
  const { data: c, error } = await ctx.supabase
    .from("clients")
    .select("id, square_customer_id, phone, email")
    .eq("id", clientId)
    .single();
  if (error) throw error;
  const now = new Date();
  const { loadLiveSchedule } = await import("./archive.server");
  const live = await loadLiveSchedule(c, now);
  return decideArchive(live.verified, live.bookings, now);
}

const idInput = (d: { client_id: string }) => {
  if (!d || typeof d.client_id !== "string") throw new Error("client_id required");
  return d;
};

export const checkArchiveEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    return evaluate(context as Ctx, data.client_id);
  });

export const archiveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertAdmin(ctx);
    const decision = await evaluate(ctx, data.client_id);
    if (!decision.allowed) throw new Error(decision.reason);
    const { error } = await ctx.supabase
      .from("clients")
      .update(archiveUpdatePayload(true))
      .eq("id", data.client_id);
    if (error) throw error;
    await ctx.supabase.from("client_activities").insert({
      client_id: data.client_id,
      activity_type: "archived",
      description: "Archived manually by admin (Square verified: no upcoming appointments)",
      metadata: { by: ctx.userId },
    });
    return { ok: true };
  });

export const restoreClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase
      .from("clients")
      .update(archiveUpdatePayload(false))
      .eq("id", data.client_id);
    if (error) throw error;
    await ctx.supabase.from("client_activities").insert({
      client_id: data.client_id,
      activity_type: "restored",
      description: "Restored from archive by admin",
      metadata: { by: ctx.userId },
    });
    return { ok: true };
  });
