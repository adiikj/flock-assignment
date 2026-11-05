import type { Request, Response, NextFunction } from "express";
import { PortalError } from "../portal/client.js";
import type { Store } from "../store.js";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);

export function requireSnapshot(store: Store) {
  if (!store.snapshot) throw new HttpError(503, "not_ready", "Initial sync from the portal has not finished yet");
  return store.snapshot;
}

export function str(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new HttpError(400, "invalid_query", `${name} must be given once (use commas for several values)`);
  const t = v.trim();
  return t === "" ? undefined : t;
}

export function list(req: Request, name: string): string[] | undefined {
  const values = str(req, name)?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return values?.length ? values : undefined;
}

export function num(req: Request, name: string, opts: { min?: number; max?: number; integer?: boolean } = {}) {
  const v = str(req, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  const invalid =
    !Number.isFinite(n) ||
    (opts.integer && !Number.isInteger(n)) ||
    (opts.min !== undefined && n < opts.min) ||
    (opts.max !== undefined && n > opts.max);
  if (invalid) {
    const range = [opts.min !== undefined && `≥ ${opts.min}`, opts.max !== undefined && `≤ ${opts.max}`].filter(Boolean).join(" and ");
    throw new HttpError(400, "invalid_query", `${name} must be ${opts.integer ? "an integer" : "a number"}${range ? " " + range : ""}`);
  }
  return n;
}

export function time(req: Request, name: string): number | undefined {
  const v = str(req, name);
  if (v === undefined) return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new HttpError(400, "invalid_query", `${name} must be an ISO 8601 date-time`);
  return t;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
  } else if (err instanceof PortalError) {
    res.status(502).json({ error: { code: "portal_unavailable", message: err.message } });
  } else {
    console.error(err);
    res.status(500).json({ error: { code: "internal", message: "Unexpected error" } });
  }
}