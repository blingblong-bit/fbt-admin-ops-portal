import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Client, ClientActivity } from "@/lib/clients";

type ActivityLite = Omit<ClientActivity, "metadata">;

export type MergePairClient = Client & {
  activities?: ActivityLite[];
  is_square_linked: boolean;
  has_square_import_marker: boolean;
};

export type MergePairConfidence =
  | "high_name_phone"
  | "name_only"
  | "phone_only";

export type MergePair = {
  review_id: string | null;
  status: "pending" | "merged" | "ignored" | "blocked" | "shared_phone";
  confidence: MergePairConfidence;
  recommended_keep_id: string | null;
  balance_conflict: boolean;
  square_conflict: boolean;
  reason: string;
  left: MergePairClient; // legacy candidate
  right: MergePairClient; // square-linked candidate
};

function normName(first: string | null | undefined, last: string | null | undefined): string {
  return `${(first ?? "").trim()} ${(last ?? "").trim()}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normPhone(p: string | null | undefined): string {
  const digits = (p ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function fetchAllActiveClients(supabase: unknown): Promise<Client[]> {
  const c = supabase as {
    from: (t: string) => {
      select: (s: string) => {
        is: (col: string, v: null) => {
          order: (col: string, opts: { ascending: boolean }) => {
            range: (a: number, b: number) => Promise<{ data: Client[] | null; error: unknown }>;
          };
        };
      };
    };
  };
  const all: Client[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await c
      .from("clients")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Client[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export const findDuplicatePairs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ pairs: MergePair[] }> => {
    const clients = await fetchAllActiveClients(context.supabase);

    // Fetch existing reviews so we can preserve status
    const { data: reviews, error: rErr } = await context.supabase
      .from("duplicate_client_reviews")
      .select("*");
    if (rErr) throw rErr;
    type ReviewRow = {
      id: string;
      client_a_id: string;
      client_b_id: string;
      status: "pending" | "merged" | "ignored" | "blocked";
      reason: string | null;
    };
    const reviewByPair = new Map<string, ReviewRow>();
    for (const r of (reviews ?? []) as ReviewRow[]) {
      reviewByPair.set(`${r.client_a_id}|${r.client_b_id}`, r);
    }

    const clientById = new Map<string, Client>(clients.map((c) => [c.id, c]));

    // Bucket by name and phone — ONLY non-archived clients participate in
    // generating new pending pairs. Archived clients (typically legacy records
    // already merged into a Square-linked client) must not resurrect as new
    // pending duplicates.
    const scanClients = clients.filter((c) => c.status !== "archived");
    const byName = new Map<string, Client[]>();
    const byPhone = new Map<string, Client[]>();
    for (const c of scanClients) {
      const n = normName(c.first_name, c.last_name);
      const p = normPhone(c.phone);
      if (n) {
        const arr = byName.get(n) ?? [];
        arr.push(c);
        byName.set(n, arr);
      }
      if (p) {
        const arr = byPhone.get(p) ?? [];
        arr.push(c);
        byPhone.set(p, arr);
      }
    }

    type Candidate = { a: string; b: string; nameMatch: boolean; phoneMatch: boolean };
    const candidates = new Map<string, Candidate>();

    function addPair(a: Client, b: Client, kind: "name" | "phone") {
      if (a.id === b.id) return;
      const [x, y] = orderPair(a.id, b.id);
      const key = `${x}|${y}`;
      const existing = candidates.get(key) ?? {
        a: x,
        b: y,
        nameMatch: false,
        phoneMatch: false,
      };
      if (kind === "name") existing.nameMatch = true;
      else existing.phoneMatch = true;
      candidates.set(key, existing);
    }

    for (const arr of byName.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) addPair(arr[i], arr[j], "name");
      }
    }
    for (const arr of byPhone.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) addPair(arr[i], arr[j], "phone");
      }
    }

    // Also surface resolved / blocked reviews (merged, ignored, blocked) even
    // when one side is now archived — so they still appear in the
    // Merged/Ignored history bucket. Pending review rows for pairs where
    // either side is archived are skipped: they no longer belong in pending
    // tabs.
    for (const r of (reviews ?? []) as ReviewRow[]) {
      const a = clientById.get(r.client_a_id);
      const b = clientById.get(r.client_b_id);
      if (!a || !b) continue;
      const eitherArchived = a.status === "archived" || b.status === "archived";
      if (r.status === "pending" && eitherArchived) continue;
      const key = `${r.client_a_id}|${r.client_b_id}`;
      if (candidates.has(key)) continue;
      // Recompute name/phone match flags from current data.
      const nameMatch =
        !!normName(a.first_name, a.last_name) &&
        normName(a.first_name, a.last_name) === normName(b.first_name, b.last_name);
      const phoneMatch =
        !!normPhone(a.phone) && normPhone(a.phone) === normPhone(b.phone);
      if (!nameMatch && !phoneMatch) continue;
      candidates.set(key, { a: r.client_a_id, b: r.client_b_id, nameMatch, phoneMatch });
    }

    // Fetch activities for all clients involved
    const involved = new Set<string>();
    for (const cand of candidates.values()) {
      involved.add(cand.a);
      involved.add(cand.b);
    }
    const clientIds = Array.from(involved);
    const activitiesByClient = new Map<string, ActivityLite[]>();
    if (clientIds.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < clientIds.length; i += chunkSize) {
        const chunk = clientIds.slice(i, i + chunkSize);
        const { data: acts, error: aErr } = await context.supabase
          .from("client_activities")
          .select("*")
          .in("client_id", chunk)
          .order("created_at", { ascending: false });
        if (aErr) throw aErr;
        for (const row of (acts ?? []) as ClientActivity[]) {
          const arr = activitiesByClient.get(row.client_id) ?? [];
          arr.push(row);
          activitiesByClient.set(row.client_id, arr);
        }
      }
    }

    function hasSquareImportMarker(id: string): boolean {
      const acts = activitiesByClient.get(id) ?? [];
      return acts.some((a) =>
        (a.description ?? "").toLowerCase().includes("imported from square"),
      );
    }

    function enrich(c: Client): MergePairClient {
      return {
        ...c,
        activities: (activitiesByClient.get(c.id) ?? []).slice(0, 8),
        is_square_linked: !!c.square_customer_id,
        has_square_import_marker: hasSquareImportMarker(c.id),
      };
    }

    const pairs: MergePair[] = [];
    for (const cand of candidates.values()) {
      const a = clientById.get(cand.a);
      const b = clientById.get(cand.b);
      if (!a || !b) continue;

      // Determine legacy (left) vs square-linked (right)
      let left = a;
      let right = b;
      const aSq = !!a.square_customer_id;
      const bSq = !!b.square_customer_id;
      if (aSq && !bSq) {
        left = b;
        right = a;
      } else if (!aSq && bSq) {
        left = a;
        right = b;
      } else {
        // both or neither square linked — put marker-tagged as right if applicable
        const aMark = hasSquareImportMarker(a.id);
        const bMark = hasSquareImportMarker(b.id);
        if (aMark && !bMark) {
          left = b;
          right = a;
        } else if (!aMark && bMark) {
          left = a;
          right = b;
        }
      }

      let confidence: MergePairConfidence;
      if (cand.nameMatch && cand.phoneMatch) confidence = "high_name_phone";
      else if (cand.nameMatch) confidence = "name_only";
      else confidence = "phone_only";

      const squareConflict =
        !!left.square_customer_id &&
        !!right.square_customer_id &&
        left.square_customer_id !== right.square_customer_id;

      const leftOwed = Math.max(0, Number(left.package_price ?? 0) - Number(left.amount_paid ?? 0));
      const rightOwed = Math.max(
        0,
        Number(right.package_price ?? 0) - Number(right.amount_paid ?? 0),
      );
      const bothHavePkg =
        (Number(left.package_price ?? 0) > 0 || Number(left.package_total_visits ?? 0) > 0) &&
        (Number(right.package_price ?? 0) > 0 || Number(right.package_total_visits ?? 0) > 0);
      const balanceConflict =
        bothHavePkg &&
        (Number(left.package_price ?? 0) !== Number(right.package_price ?? 0) ||
          Number(left.amount_paid ?? 0) !== Number(right.amount_paid ?? 0) ||
          leftOwed !== rightOwed ||
          Number(left.package_total_visits ?? 0) !== Number(right.package_total_visits ?? 0));

      const recommendedKeep = right.square_customer_id
        ? right.id
        : left.square_customer_id
          ? left.id
          : null;

      const reasonParts: string[] = [];
      if (cand.nameMatch) reasonParts.push("same normalized name");
      if (cand.phoneMatch) reasonParts.push("same last-10-digit phone");

      const [pa, pb] = orderPair(left.id, right.id);
      const review = reviewByPair.get(`${pa}|${pb}`) ?? null;
      const derivedStatus: MergePair["status"] = squareConflict
        ? cand.nameMatch
          ? "blocked"
          : "shared_phone"
        : "pending";
      const status = review?.status ?? derivedStatus;

      pairs.push({
        review_id: review?.id ?? null,
        status,
        confidence,
        recommended_keep_id: recommendedKeep,
        balance_conflict: balanceConflict,
        square_conflict: squareConflict,
        reason: reasonParts.join(" + "),
        left: enrich(left),
        right: enrich(right),
      });
    }

    // Sort: pending first, then by confidence, then square-linked availability
    const confidenceRank: Record<MergePairConfidence, number> = {
      high_name_phone: 0,
      name_only: 1,
      phone_only: 2,
    };
    const statusRank: Record<MergePair["status"], number> = {
      pending: 0,
      blocked: 1,
      shared_phone: 2,
      merged: 3,
      ignored: 4,
    };
    pairs.sort((x, y) => {
      const s = statusRank[x.status] - statusRank[y.status];
      if (s !== 0) return s;
      const c = confidenceRank[x.confidence] - confidenceRank[y.confidence];
      if (c !== 0) return c;
      return `${x.left.last_name} ${x.left.first_name}`.localeCompare(
        `${y.left.last_name} ${y.left.first_name}`,
      );
    });

    return { pairs };
  });

export type MergeResult = {
  kept_client_id: string;
  archived_client_id: string;
  fields_copied: string[];
};

/**
 * Merge legacy client into a kept client. Only fills BLANK fields on the kept
 * client. Appends legacy notes. Archives (status='archived') the legacy client
 * — does NOT delete. Adds timeline entries on both sides.
 */
export const mergeDuplicatePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kept_id: string; archive_id: string; force?: boolean }) => d)
  .handler(async ({ data, context }): Promise<MergeResult> => {
    if (data.kept_id === data.archive_id) throw new Error("Cannot merge a client into itself");

    const { data: rows, error } = await context.supabase
      .from("clients")
      .select("*")
      .in("id", [data.kept_id, data.archive_id]);
    if (error) throw error;
    const both = (rows ?? []) as Client[];
    const kept = both.find((c) => c.id === data.kept_id);
    const archive = both.find((c) => c.id === data.archive_id);
    if (!kept || !archive) throw new Error("One or both clients not found");
    if (archive.deleted_at) throw new Error("Legacy client is deleted");

    // Safety: block if both have different square_customer_id
    if (
      kept.square_customer_id &&
      archive.square_customer_id &&
      kept.square_customer_id !== archive.square_customer_id
    ) {
      throw new Error(
        "Both clients have different Square customer IDs. Manual review required — merge blocked.",
      );
    }

    // Balance conflict guard
    const bothHavePkg =
      (Number(kept.package_price ?? 0) > 0 || Number(kept.package_total_visits ?? 0) > 0) &&
      (Number(archive.package_price ?? 0) > 0 || Number(archive.package_total_visits ?? 0) > 0);
    const conflict =
      bothHavePkg &&
      (Number(kept.package_price ?? 0) !== Number(archive.package_price ?? 0) ||
        Number(kept.amount_paid ?? 0) !== Number(archive.amount_paid ?? 0) ||
        Number(kept.package_total_visits ?? 0) !== Number(archive.package_total_visits ?? 0));
    if (conflict && !data.force) {
      throw new Error(
        "Both records have conflicting package/payment data. Confirm with force=true to override.",
      );
    }

    const patch: Record<string, unknown> = {};
    const fieldsCopied: string[] = [];

    // Copy scalar fields only if kept is blank
    const scalarFields: (keyof Client)[] = [
      "phone",
      "email",
      "package_name",
      "package_start_date",
      "square_visit_note",
      "square_customer_id",
    ];
    for (const f of scalarFields) {
      const keptVal = kept[f];
      const archVal = archive[f];
      const keptEmpty = keptVal === null || keptVal === undefined || keptVal === "";
      const archHas = !(archVal === null || archVal === undefined || archVal === "");
      if (keptEmpty && archHas) {
        patch[f as string] = archVal;
        fieldsCopied.push(f as string);
      }
    }

    // Package/payment: only copy if kept has no package info at all
    const keptHasPkg =
      Number(kept.package_price ?? 0) > 0 || Number(kept.package_total_visits ?? 0) > 0;
    const archHasPkg =
      Number(archive.package_price ?? 0) > 0 || Number(archive.package_total_visits ?? 0) > 0;
    if (!keptHasPkg && archHasPkg) {
      patch.package_price = archive.package_price;
      patch.package_total_visits = archive.package_total_visits;
      patch.amount_paid = archive.amount_paid;
      if (archive.visits_used !== null && archive.visits_used !== undefined) {
        patch.visits_used = archive.visits_used;
      }
      fieldsCopied.push("package_price", "package_total_visits", "amount_paid", "visits_used");
    }

    // Append structured "Legacy Notes" block (only once per kept client)
    const legacyNotes = (archive.internal_notes ?? "").trim();
    const legacyPhone = (archive.phone ?? "").trim();
    const existingKeptNotes = kept.internal_notes ?? "";
    const alreadyHasBlock = /(^|\n)Legacy Notes\n-+/.test(existingKeptNotes);
    if (!alreadyHasBlock && (legacyPhone || legacyNotes)) {
      const lines: string[] = ["Legacy Notes", "------------"];
      if (legacyPhone) lines.push(`Legacy Phone: ${legacyPhone}`);
      if (legacyNotes) {
        if (legacyPhone) lines.push("");
        lines.push("Legacy Notes:", legacyNotes);
      }
      const block = lines.join("\n");
      patch.internal_notes = existingKeptNotes.trim()
        ? `${existingKeptNotes.trimEnd()}\n\n${block}`
        : block;
      fieldsCopied.push("internal_notes");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (Object.keys(patch).length > 0) {
      const { error: uErr } = await supabaseAdmin
        .from("clients")
        .update(patch as never)
        .eq("id", kept.id);
      if (uErr) throw uErr;
    }

    // If this is a legacy → square-linked merge (one side has square_customer_id
    // and the other does not), reactivate the kept Square-linked client. It may
    // have been archived by cleanup before the merge and would otherwise stay
    // archived after copying the legacy data over.
    const keptIsSquare = !!kept.square_customer_id && !archive.square_customer_id;
    const archiveIsSquare = !!archive.square_customer_id && !kept.square_customer_id;
    if (keptIsSquare) {
      const { error: reErr } = await supabaseAdmin
        .from("clients")
        .update({ status: "active", manual_active: true, deleted_at: null })
        .eq("id", kept.id);
      if (reErr) throw reErr;
    }

    // Archive legacy client (only when the archive side is the non-Square one).
    // If somehow the archive side is the Square-linked one, still mark archived
    // per existing behavior but do not clear its Square linkage.
    const { error: aErr } = await supabaseAdmin
      .from("clients")
      .update({ status: "archived", manual_active: false })
      .eq("id", archive.id);
    if (aErr) throw aErr;
    void archiveIsSquare;


    const keptName = `${kept.first_name} ${kept.last_name}`.trim();
    const archName = `${archive.first_name} ${archive.last_name}`.trim();

    await supabaseAdmin.from("client_activities").insert([
      {
        client_id: kept.id,
        activity_type: "merge",
        description: `Merged legacy Notes client "${archName}" into this Square-linked client`,
        metadata: {
          archived_client_id: archive.id,
          fields_copied: fieldsCopied,
          forced: !!data.force,
        },
      },
      {
        client_id: archive.id,
        activity_type: "archived",
        description: `Archived after merge into ${keptName} (${kept.id.slice(0, 8)})`,
        metadata: { kept_client_id: kept.id },
      },
    ]);

    // Upsert review row
    const [pa, pb] = orderPair(kept.id, archive.id);
    await supabaseAdmin
      .from("duplicate_client_reviews")
      .upsert(
        {
          client_a_id: pa,
          client_b_id: pb,
          status: "merged",
          kept_client_id: kept.id,
          archived_client_id: archive.id,
          reason: fieldsCopied.length ? `Copied: ${fieldsCopied.join(", ")}` : "No new fields copied",
          resolved_at: new Date().toISOString(),
        },
        { onConflict: "client_a_id,client_b_id" },
      );

    return {
      kept_client_id: kept.id,
      archived_client_id: archive.id,
      fields_copied: fieldsCopied,
    };
  });

export const ignoreDuplicatePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { a_id: string; b_id: string; reason?: string }) => d)
  .handler(async ({ data }) => {
    const [pa, pb] = orderPair(data.a_id, data.b_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("duplicate_client_reviews")
      .upsert(
        {
          client_a_id: pa,
          client_b_id: pb,
          status: "ignored",
          reason: data.reason ?? null,
          resolved_at: new Date().toISOString(),
        },
        { onConflict: "client_a_id,client_b_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const resetDuplicateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { a_id: string; b_id: string }) => d)
  .handler(async ({ data }) => {
    const [pa, pb] = orderPair(data.a_id, data.b_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("duplicate_client_reviews")
      .delete()
      .eq("client_a_id", pa)
      .eq("client_b_id", pb);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Restore a merged/archived client back to active status. This does NOT
 * automatically revert copied fields on the kept client — staff should manually
 * verify. It marks the review row as pending again.
 */
export const restoreArchivedMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { archived_id: string; kept_id: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ status: "active" })
      .eq("id", data.archived_id);
    if (error) throw error;
    await supabaseAdmin.from("client_activities").insert({
      client_id: data.archived_id,
      activity_type: "restored",
      description: `Restored from archive (previous merge into ${data.kept_id.slice(0, 8)} rolled back)`,
    });
    const [pa, pb] = orderPair(data.kept_id, data.archived_id);
    await supabaseAdmin
      .from("duplicate_client_reviews")
      .update({ status: "pending", resolved_at: null })
      .eq("client_a_id", pa)
      .eq("client_b_id", pb);
    return { ok: true };
  });
