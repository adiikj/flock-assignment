import { Router } from "express";
import { LEVELS, type Level, type Meter } from "../model.js";
import type { Store } from "../store.js";
import type { PortalApi } from "../portal/api.js";
import { readingsFor } from "../sync/sync.js";
import { deriveIntervals, summarize } from "../readings.js";
import { distanceKm } from "../geo.js";
import { round } from "../util.js";
import { HttpError, list, notFound, num, requireSnapshot, str, time } from "./http.js";

export function metersRouter(store: Store, api: PortalApi) {
  const router = Router();

  const findMeter = (id: string) => {
    requireSnapshot(store);
    const meter = store.meter(id.trim().toUpperCase());
    if (!meter) throw notFound(`Meter ${id}`);
    return meter;
  };

  // GET /v1/meters: filter across any attribute, any hierarchy level, or distance from a point
  router.get("/", (req, res) => {
    const snapshot = requireSnapshot(store);
    const q = str(req, "q")?.toLowerCase();

    const fieldFilters: Array<[keyof Meter, string[] | undefined]> = [
      ["installStatus", list(req, "status")],
      ["make", list(req, "make")],
      ["phaseType", list(req, "phase")],
      ["installType", list(req, "installType")],
      ["build", list(req, "build")],
    ];
    const levelFilters = LEVELS.map((level) => [level, list(req, level)] as const).filter(
      (f): f is readonly [Level, string[]] => f[1] !== undefined,
    );

    const lat = num(req, "lat", { min: -90, max: 90 });
    const lng = num(req, "lng", { min: -180, max: 180 });
    const radiusKm = num(req, "radiusKm", { min: 0, max: 100 });
    if ((lat === undefined) !== (lng === undefined)) throw new HttpError(400, "invalid_query", "lat and lng must be given together");
    if (radiusKm !== undefined && lat === undefined) throw new HttpError(400, "invalid_query", "radiusKm requires lat and lng");

    const limit = num(req, "limit", { min: 1, max: 500, integer: true }) ?? 50;
    const offset = num(req, "offset", { min: 0, integer: true }) ?? 0;

    const matches = snapshot.meters.filter((m) => {
      if (q && !m.meterId.toLowerCase().includes(q) && !(m.serialNo ?? "").toLowerCase().includes(q)) return false;
      for (const [field, allowed] of fieldFilters) {
        if (allowed && !allowed.includes(String(m[field] ?? "").toLowerCase())) return false;
      }
      for (const [level, allowed] of levelFilters) {
        if (!allowed.includes((m.hierarchy[level].code ?? "").toLowerCase())) return false;
      }
      return true;
    });

    let rows: Array<Meter & { distanceKm?: number }> = matches;
    if (lat !== undefined && lng !== undefined) {
      rows = matches
        .filter((m) => m.location)
        .map((m) => ({ ...m, distanceKm: round(distanceKm({ lat, lng }, m.location!)) }))
        .filter((m) => radiusKm === undefined || m.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }

    res.json({ data: rows.slice(offset, offset + limit), page: { total: rows.length, limit, offset } });
  });

  // GET /v1/meters/:meterId
  router.get("/:meterId", (req, res) => {
    const meter = findMeter(req.params.meterId);
    const snapshot = store.snapshot!;
    res.json({
      data: {
        ...meter,
        transformer: snapshot.transformers.find((t) => t.code === meter.hierarchy.dt.code) ?? null,
        issues: snapshot.issues.filter((i) => i.entity === `meter:${meter.meterId}`),
      },
    });
  });

  // GET /v1/meters/:meterId/readings: half-hourly readings plus derived consumption
  router.get("/:meterId/readings", async (req, res) => {
    const meter = findMeter(req.params.meterId);
    const from = time(req, "from");
    const to = time(req, "to");

    const intervals = deriveIntervals(await readingsFor(api, store, meter.meterId)).filter((r) => {
      const t = Date.parse(r.timestamp);
      return (from === undefined || t >= from) && (to === undefined || t <= to);
    });

    res.json({ data: { meterId: meter.meterId, summary: summarize(intervals), readings: intervals } });
  });

  return router;
}