import { Router } from "express";
import type { TreeNode } from "../model.js";
import type { Store } from "../store.js";
import { countBy } from "../util.js";
import { list, num, requireSnapshot } from "./http.js";

export function networkRouter(store: Store) {
  const router = Router();

  // Path-keyed tree: zone → circle → division → subdivision → substation → feeder → dt
  router.get("/hierarchy", (req, res) => {
    const { tree } = requireSnapshot(store);
    const depth = num(req, "depth", { min: 1, max: 7, integer: true });
    const prune = (nodes: TreeNode[], d: number): TreeNode[] =>
      nodes.map((n) => ({ ...n, children: d > 1 ? prune(n.children, d - 1) : [] }));
    res.json({ data: depth ? prune(tree, depth) : tree });
  });

  // Every repair, conflict and inconsistency found while normalising the portal's data
  router.get("/data-quality", (req, res) => {
    const { issues } = requireSnapshot(store);
    const types = list(req, "type");
    res.json({
      data: {
        summary: countBy(issues, (i) => i.type),
        issues: types ? issues.filter((i) => types.includes(i.type)) : issues,
      },
    });
  });

  router.get("/stats", (_req, res) => {
    const { meters, transformers, syncedAt } = requireSnapshot(store);

    // Shows, without assuming any prefix→make mapping, that serial prefixes don't predict make
    const serialPrefixByMake: Record<string, Record<string, number>> = {};
    for (const m of meters) {
      const prefix = (m.serialNo ?? "").slice(0, 2) || "unknown";
      const make = m.make ?? "unknown";
      serialPrefixByMake[prefix] ??= {};
      serialPrefixByMake[prefix][make] = (serialPrefixByMake[prefix][make] ?? 0) + 1;
    }

    res.json({
      data: {
        syncedAt,
        meters: meters.length,
        transformers: transformers.length,
        byStatus: countBy(meters, (m) => m.installStatus),
        byMake: countBy(meters, (m) => m.make),
        byPhase: countBy(meters, (m) => m.phaseType),
        byInstallType: countBy(meters, (m) => m.installType),
        byBuild: countBy(meters, (m) => m.build),
        serialPrefixByMake,
      },
    });
  });

  return router;
}