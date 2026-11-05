import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Meter, Transformer, TreeNode, DataIssue } from "./model.js";
import type { Reading } from "./portal/parse.js";

export interface Snapshot {
  syncedAt: string;
  meters: Meter[];
  transformers: Transformer[];
  tree: TreeNode[];
  issues: DataIssue[];
}

const SNAPSHOT_FILE = path.resolve("data/snapshot.json");

/** Everything the API serves. ~400 meters fits comfortably in memory; the README covers where this stops scaling. */
export class Store {
  snapshot: Snapshot | null = null;
  private meterById = new Map<string, Meter>();
  private readings = new Map<string, { fetchedAt: number; readings: Reading[] }>();

  replace(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.meterById = new Map(snapshot.meters.map((m) => [m.meterId, m]));
  }

  meter(meterId: string): Meter | undefined {
    return this.meterById.get(meterId);
  }

  cachedReadings(meterId: string, maxAgeMs: number): Reading[] | undefined {
    const hit = this.readings.get(meterId);
    return hit && Date.now() - hit.fetchedAt < maxAgeMs ? hit.readings : undefined;
  }

  setReadings(meterId: string, readings: Reading[]) {
    this.readings.set(meterId, { fetchedAt: Date.now(), readings });
  }

  async save() {
    if (!this.snapshot) return;
    await mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true });
    await writeFile(SNAPSHOT_FILE, JSON.stringify(this.snapshot));
  }

  async load(): Promise<boolean> {
    try {
      this.replace(JSON.parse(await readFile(SNAPSHOT_FILE, "utf8")));
      return true;
    } catch {
      return false;
    }
  }
}