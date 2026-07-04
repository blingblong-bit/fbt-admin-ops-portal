// Shared helper for applying a Square payment to a client's balance exactly once.
// Preserves the exact behavior previously duplicated in
// src/lib/payments.functions.ts and src/routes/api/public/square.webhook.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyPaymentOnce(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  {
    clientId,
    squarePaymentId,
    amountCents,
    matchMethod,
    manualResolution,
  }: {
    clientId: string;
    squarePaymentId: string;
    amountCents: number;
    matchMethod: string | null;
    manualResolution?: boolean;
  },
): Promise<{ credited: boolean; appliedAmount: number; alreadyApplied: boolean }> {
  // Guard 1: activity already logged for this payment id
  const { data: existingActivity } = await supabaseAdmin
    .from("client_activities")
    .select("id")
    .eq("client_id", clientId)
    .contains("metadata", { square_payment_id: squarePaymentId } as unknown as never)
    .limit(1);
  if (existingActivity && existingActivity.length > 0) {
    return { credited: false, appliedAmount: 0, alreadyApplied: true };
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("amount_paid, package_price")
    .eq("id", clientId)
    .single();
  if (clientErr) throw clientErr;

  const amountDollars = amountCents / 100;
  const currentPaid = Number(client.amount_paid ?? 0);
  const price = Number(client.package_price ?? 0);
  const newPaid =
    price > 0 ? Math.min(price, currentPaid + amountDollars) : currentPaid + amountDollars;
  const appliedAmount = Math.max(0, newPaid - currentPaid);

  const { error: updErr } = await supabaseAdmin
    .from("clients")
    .update({ amount_paid: newPaid })
    .eq("id", clientId);
  if (updErr) throw updErr;

  const metadata: Record<string, unknown> = {
    source: "square",
    square_payment_id: squarePaymentId,
    amount: amountDollars,
    applied_amount: appliedAmount,
    match_method: matchMethod,
  };
  if (manualResolution) {
    metadata.manual_resolution = true;
  }

  await supabaseAdmin.from("client_activities").insert({
    client_id: clientId,
    activity_type: "payment",
    description: `Square payment synced — $${amountDollars.toFixed(2)}`,
    metadata: metadata as unknown as never,
  });

  return { credited: true, appliedAmount, alreadyApplied: false };
}
