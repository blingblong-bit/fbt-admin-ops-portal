import { catalogServices, type CatalogObject } from "./assessment-package-review";

/** Catalog-only POST retrieval; no Square mutations. Fail closed on partial reads. */
export async function loadSquareServices(token: string, variationIds: string[]) {
  const objects: CatalogObject[] = [];
  const ids = [...new Set(variationIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetch("https://connect.squareup.com/v2/catalog/batch-retrieve", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Square-Version": "2024-10-17", "Content-Type": "application/json" },
      body: JSON.stringify({ object_ids: ids.slice(i, i + 100), include_related_objects: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("Square service types couldn't be read. Try Refresh.");
    const json = await res.json() as { objects?: CatalogObject[]; related_objects?: CatalogObject[] };
    objects.push(...json.objects ?? [], ...json.related_objects ?? []);
  }
  return catalogServices(objects);
}