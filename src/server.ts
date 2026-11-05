import { assertPortalCredentials, config } from "./config.js";
import { PortalClient } from "./portal/client.js";
import { createPortalApi } from "./portal/api.js";
import { Store } from "./store.js";
import { createApp } from "./app.js";
import { ensureFresh, prefetchAllReadings, syncMetadata, METADATA_MAX_AGE_MS } from "./sync/sync.js";

assertPortalCredentials();

const api = createPortalApi(new PortalClient());
const store = new Store();

createApp(store, api).listen(config.port, () => {
  console.log(`Urja API on http://localhost:${config.port} (docs: /docs)`);
});

// Sync in the background so /health answers immediately; data routes return 503 until ready.
ensureFresh(api, store)
  .then(() => prefetchAllReadings(api, store))
  .then((failed) => console.log(`Readings warm-up finished (${failed} meters failed)`))
  .catch((err) => console.error("Initial sync failed:", err));

setInterval(() => {
  syncMetadata(api, store).catch((err) => console.warn("Scheduled sync failed; keeping previous snapshot", err));
}, METADATA_MAX_AGE_MS).unref();