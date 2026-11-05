import { Router } from "express";
import type { Store } from "../store.js";
import { countBy } from "../util.js";
import { list, notFound, requireSnapshot } from "./http.js";

export function transformersRouter(store: Store) {
  const router = Router();

  router.get("/", (req, res) => {
    const snapshot = requireSnapshot(store);
    const feeder = list(req, "feeder");
    const rows = snapshot.transformers.filter((t) => !feeder || feeder.includes((t.feederCode ?? "").toLowerCase()));
    res.json({ data: rows, page: { total: rows.length } });
  });

  router.get("/:code", (req, res) => {
    const snapshot = requireSnapshot(store);
    const code = req.params.code.trim().toUpperCase();
    const transformer = snapshot.transformers.find((t) => t.code === code);
    if (!transformer) throw notFound(`Transformer ${req.params.code}`);

    const meters = snapshot.meters.filter((m) => m.hierarchy.dt.code === code);
    res.json({
      data: {
        ...transformer,
        statusCounts: countBy(meters, (m) => m.installStatus),
        meters: meters.map(({ meterId, serialNo, make, phaseType, installStatus }) => ({
          meterId, serialNo, make, phaseType, installStatus,
        })),
        issues: snapshot.issues.filter((i) => i.entity === `dt:${code}`),
      },
    });
  });

  return router;
}