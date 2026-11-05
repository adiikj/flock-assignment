// ---- Raw shapes exactly as the portal returns them ----

export interface RawPage<T> {
  data: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface RawExportRow {
  meterId: string;
  serialNo: string;
  make: string;
  phaseType: string;
  installStatus: string;
  installType: string;
  build: string;
  dtCode: string;
  hierarchy?: Partial<Record<string, { name?: string; code?: string }>>;
  geo?: { lat?: number | string; lng?: number | string };
}

export interface RawDt {
  code: string;
  name: string;
  feederCode: string;
  capacityKva: number | string;
}

/** Note: every value is a string, including the numbers. */
export interface RawReading {
  timestamp: string; // "23/06/2026 23:30"
  kwh: string;
  kvah: string;
  voltR: string;
}

export interface Reading {
  timestamp: string;       // ISO 8601 with +05:30
  kwh: number | null;      // cumulative register
  kvah: number | null;     // cumulative register
  voltageR: number | null; // R-phase voltage (V)
}

export function parsePortalTimestamp(s: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Unexpected portal timestamp: "${s}"`);
  const [, dd, mm, yyyy, hh, min] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`;
}

export function toNumber(s: unknown): number | null {
  if (s === null || s === undefined || String(s).trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseReading(r: RawReading): Reading {
  return {
    timestamp: parsePortalTimestamp(r.timestamp),
    kwh: toNumber(r.kwh),
    kvah: toNumber(r.kvah),
    voltageR: toNumber(r.voltR),
  };
}