import express, { type Router } from "express";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "node:fs";
import type { Store } from "./store.js";
import type { PortalApi } from "./portal/api.js";
import { metersRouter } from "./api/meters.js";
import { transformersRouter } from "./api/transformers.js";
import { networkRouter } from "./api/network.js";
import { errorHandler } from "./api/http.js";

export const openapiSpec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));

export function buildMounts(store: Store, api: PortalApi): Array<[string, Router]> {
  return [
    ["/v1/meters", metersRouter(store, api)],
    ["/v1/transformers", transformersRouter(store)],
    ["/v1", networkRouter(store)],
  ];
}

export function createApp(store: Store, api: PortalApi) {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({
      status: store.snapshot ? "ok" : "starting",
      syncedAt: store.snapshot?.syncedAt ?? null,
      meters: store.snapshot?.meters.length ?? 0,
    });
  });
  app.get("/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

  for (const [prefix, router] of buildMounts(store, api)) app.use(prefix, router);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "No such route" } });
  });
  app.use(errorHandler);
  return app;
}