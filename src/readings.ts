import type { Reading } from "./portal/parse.js";
import { round } from "./util.js";

const STEP_MS = 30 * 60_000; // the portal reads every 30 minutes
// Assumption: 230 V nominal LV supply, ±6% tolerance. Change if the utility uses another band.
const VOLTAGE_MIN = 216.2;
const VOLTAGE_MAX = 243.8;

export interface Interval extends Reading {
  kwhDelta: number | null;    // energy used since the previous reading
  kvahDelta: number | null;
  powerFactor: number | null; // kwhDelta / kvahDelta
  flags: string[];
}

/** The portal sends cumulative registers; consumption is the difference between consecutive readings. */
export function deriveIntervals(readings: Reading[]): Interval[] {
  const sorted = [...readings].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  return sorted.map((r, i) => {
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const flags: string[] = [];

    const delta = (cur: number | null, before: number | null | undefined, name: string) => {
      if (cur === null || before === null || before === undefined) return null;
      const d = round(cur - before);
      if (d < 0) {
        flags.push(`${name}_register_decreased`); // reset, rollover or bad data; never report negative usage
        return null;
      }
      return d;
    };

    const kwhDelta = delta(r.kwh, prev?.kwh, "kwh");
    const kvahDelta = delta(r.kvah, prev?.kvah, "kvah");

    if (prev && Date.parse(r.timestamp) - Date.parse(prev.timestamp) !== STEP_MS) flags.push("irregular_interval");
    if (r.voltageR !== null && (r.voltageR < VOLTAGE_MIN || r.voltageR > VOLTAGE_MAX)) flags.push("voltage_out_of_range");

    const powerFactor = kwhDelta !== null && kvahDelta ? round(kwhDelta / kvahDelta) : null;
    return { ...r, kwhDelta, kvahDelta, powerFactor, flags };
  });
}

export function summarize(intervals: Interval[]) {
  const kwh = intervals.flatMap((i) => (i.kwhDelta === null ? [] : [i.kwhDelta]));
  const volts = intervals.flatMap((i) => (i.voltageR === null ? [] : [i.voltageR]));
  return {
    readingCount: intervals.length,
    firstReadingAt: intervals[0]?.timestamp ?? null,
    lastReadingAt: intervals.at(-1)?.timestamp ?? null,
    totalKwh: round(kwh.reduce((a, b) => a + b, 0)),
    peakIntervalKwh: kwh.length ? Math.max(...kwh) : null,
    voltageR: volts.length
      ? { min: Math.min(...volts), max: Math.max(...volts), avg: round(volts.reduce((a, b) => a + b, 0) / volts.length, 1) }
      : null,
    flaggedIntervals: intervals.filter((i) => i.flags.length > 0).length,
  };
}