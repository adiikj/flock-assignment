import { PortalClient } from "../src/portal/client.js";
import { createPortalApi } from "../src/portal/api.js";

// Live smoke test: npx tsx --env-file=.env scripts/probe.ts
const api = createPortalApi(new PortalClient());

const dts = await api.listDts(1);
console.log(`dts:    ${dts.data.length} rows on page 1, total ${dts.total}`);

const exp = await api.exportMeters(1);
console.log(`export: ${exp.data.length} rows on page 1, total ${exp.total}`);

const energy = await api.meterEnergy("J100031");
console.log(`energy: ${energy.length} readings for J100031, last ${energy.at(-1)?.timestamp}`);