import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseReading, parsePortalTimestamp, type Reading } from "../src/portal/parse.js";
import { deriveIntervals, summarize } from "../src/readings.js";

const raw = JSON.parse(readFileSync(new URL("./fixtures/energy-J100031.json", import.meta.url), "utf8")).data;
const reading = (timestamp: string, kwh: number, kvah: number, voltageR = 230): Reading => ({ timestamp, kwh, kvah, voltageR });

describe("parsing", () => {
  it("converts the portal's DD/MM/YYYY timestamps to ISO 8601 in IST", () => {
    expect(parsePortalTimestamp("23/06/2026 23:30")).toBe("2026-06-23T23:30:00+05:30");
  });

  it("turns string numbers into numbers", () => {
    expect(parseReading(raw[0])).toEqual({ timestamp: "2026-06-23T23:30:00+05:30", kwh: 32128.97, kvah: 34699.29, voltageR: 221 });
  });

  it("rejects an unexpected timestamp format loudly", () => {
    expect(() => parsePortalTimestamp("2026-06-23 23:30")).toThrow();
  });
});

describe("deriveIntervals", () => {
  const intervals = deriveIntervals(raw.map(parseReading));

  it("computes consumption from consecutive cumulative readings", () => {
    expect(intervals[0].kwhDelta).toBeNull();
    expect(intervals[1].kwhDelta).toBe(0.39);
    expect(intervals[1].kvahDelta).toBe(0.42);
    expect(intervals[1].powerFactor).toBe(0.929);
  });

  it("summarises the window", () => {
    expect(summarize(intervals)).toMatchObject({
      readingCount: 5,
      totalKwh: 1.57,
      voltageR: { min: 220, max: 234, avg: 225.8 },
      flaggedIntervals: 0,
    });
  });

  it("flags a decreasing register instead of reporting negative usage", () => {
    const [, second] = deriveIntervals([
      reading("2026-06-24T00:00:00+05:30", 100, 110),
      reading("2026-06-24T00:30:00+05:30", 90, 115),
    ]);
    expect(second.kwhDelta).toBeNull();
    expect(second.flags).toContain("kwh_register_decreased");
  });

  it("flags gaps and out-of-range voltage", () => {
    const [, second] = deriveIntervals([
      reading("2026-06-24T00:00:00+05:30", 100, 110),
      reading("2026-06-24T01:30:00+05:30", 101, 111, 250),
    ]);
    expect(second.flags).toEqual(expect.arrayContaining(["irregular_interval", "voltage_out_of_range"]));
  });
});