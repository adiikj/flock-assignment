import { describe, it, expect } from "vitest";
import { buildMounts, openapiSpec } from "../src/app.js";
import { Store } from "../src/store.js";
import type { PortalApi } from "../src/portal/api.js";

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

describe("openapi.json", () => {
  it("documents exactly the routes Express serves", () => {
    const served = new Set<string>(["get /health"]);
    for (const [prefix, router] of buildMounts(new Store(), {} as PortalApi)) {
      for (const layer of (router as unknown as { stack: Layer[] }).stack) {
        if (!layer.route) continue;
        const path = (prefix + (layer.route.path === "/" ? "" : layer.route.path)).replace(/:(\w+)/g, "{$1}");
        for (const method of Object.keys(layer.route.methods)) served.add(`${method} ${path}`);
      }
    }

    const documented = new Set<string>();
    for (const [path, ops] of Object.entries(openapiSpec.paths as Record<string, object>)) {
      for (const method of Object.keys(ops)) documented.add(`${method} ${path}`);
    }

    expect([...served].sort()).toEqual([...documented].sort());
  });
});