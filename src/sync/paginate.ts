import type { RawPage } from "../portal/parse.js";

export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<RawPage<T>>,
  keyOf: (item: T) => string,
  maxPages = 500,
): Promise<T[]> {
  const seen = new Map<string, T>();
  let expectedTotal: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page);
    if (typeof res.total === "number") expectedTotal = res.total;

    const fresh = res.data.filter((item) => !seen.has(keyOf(item)));
    for (const item of fresh) seen.set(keyOf(item), item);

    if (fresh.length === 0) break;
    if (expectedTotal !== undefined && seen.size >= expectedTotal) break;
  }

  if (expectedTotal !== undefined && seen.size !== expectedTotal) {
    console.warn(`Portal reported ${expectedTotal} items but we collected ${seen.size}`);
  }
  return [...seen.values()];
}