/** One authenticated audited transaction; no client-side money movement. */
export async function cancelPreparedTransaction(
  clientId: string,
  run: (clientId: string) => PromiseLike<{ error: { message: string } | null }>,
): Promise<{ ok: true; movedToCurrent: number }> {
  const { error } = await run(clientId);
  if (error) throw new Error(error.message);
  return { ok: true, movedToCurrent: 0 };
}