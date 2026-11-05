import type { PortalApi } from "../portal/api.js";
import { parseReading, type Reading } from "../portal/parse.js";
import type { Store } from "../store.js";
import { normalize } from "./normalize.js";
import { fetchAllPages } from "./paginate.js";
import { mapWithConcurrency } from "./pool.js";

const HOUR = 3_600_000;
// The portal's latest reading is 30 June, so it behaves like a static snapshot: long lifetimes are safe.
export const METADATA_MAX_AGE_MS = 6 * HOUR;
export const READINGS_MAX_AGE_MS = 6 * HOUR;

export async function syncMetadata(api: PortalApi, store: Store) {
  const [rows, dts] = await Promise.all([
    fetchAllPages((page) => api.exportMeters(page), (row) => row.meterId),
    fetchAllPages((page) => api.listDts(page), (dt) => dt.code),
  ]);
  store.replace({ syncedAt: new Date().toISOString(), ...normalize(rows, dts) });
  await store.save();
}

/** On start-up: use the snapshot on disk if fresh; if the portal is down, serve a stale snapshot rather than nothing. */
export async function ensureFresh(api: PortalApi, store: Store) {
  const loaded = await store.load();
  const ageMs = loaded ? Date.now() - Date.parse(store.snapshot!.syncedAt) : Infinity;
  if (ageMs <= METADATA_MAX_AGE_MS) return;
  try {
    await syncMetadata(api, store);
  } catch (err) {
    if (!loaded) throw err;
    console.warn("Portal sync failed; serving stale snapshot from", store.snapshot!.syncedAt, err);
  }
}

/** Readings are fetched on demand and cached, since there's no bulk endpoint for them. */
export async function readingsFor(api: PortalApi, store: Store, meterId: string): Promise<Reading[]> {
  const cached = store.cachedReadings(meterId, READINGS_MAX_AGE_MS);
  if (cached) return cached;
  const readings = (await api.meterEnergy(meterId)).map(parseReading);
  store.setReadings(meterId, readings);
  return readings;
}

/** Background warm-up so fleet-wide views don't wait on 400 portal calls. Returns the number of failures. */
export async function prefetchAllReadings(api: PortalApi, store: Store, concurrency = 4) {
  const ids = store.snapshot?.meters.map((m) => m.meterId) ?? [];
  const results = await mapWithConcurrency(ids, concurrency, (id) => readingsFor(api, store, id));
  return results.filter((r) => r.status === "rejected").length;
}