import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
import { normalize } from "../src/sync/normalize.js";
import type { PortalApi } from "../src/portal/api.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const store = new Store();
store.replace({
  syncedAt: "2026-11-04T00:00:00.000Z",
  ...normalize(fixture("export-sample.json").data, fixture("dts-sample.json").data),
});
const fakePortal = { meterEnergy: async () => fixture("energy-J100031.json").data } as unknown as PortalApi;
const app = createApp(store, fakePortal);

describe("API", () => {
  it("filters across attributes and hierarchy levels", async () => {
    const res = await request(app).get("/v1/meters?status=decommissioned&feeder=F-001");
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: any) => m.meterId)).toEqual(["J100000"]);
    expect(res.body.page.total).toBe(1);
  });

  it("finds meters near a point, nearest first", async () => {
    const res = await request(app).get("/v1/meters?lat=26.812653854983022&lng=75.80722787903873&radiusKm=1");
    expect(res.body.data[0]).toMatchObject({ meterId: "J100006", distanceKm: 0 });
  });

  it("returns readings with derived consumption, accepting lowercase IDs", async () => {
    const res = await request(app).get("/v1/meters/j100006/readings");
    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalKwh).toBe(1.57);
    expect(res.body.data.readings[0].timestamp).toBe("2026-06-23T23:30:00+05:30");
  });

  it("shows a transformer with its alias and meters", async () => {
    const res = await request(app).get("/v1/transformers/DT-007");
    expect(res.body.data).toMatchObject({ name: "Sanganer DT 7", aliases: ["Old Malviya Nagar Xfmr"], meterCount: 2 });
  });

  it("returns clear errors", async () => {
    const missing = await request(app).get("/v1/meters/J999999");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");

    const bad = await request(app).get("/v1/meters?lat=26.9");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_query");
  });

  it("answers 503 until the first sync has finished", async () => {
    const res = await request(createApp(new Store(), fakePortal)).get("/v1/meters");
    expect(res.status).toBe(503);
  });
});