import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalize } from "../src/sync/normalize.js";
import type { TreeNode } from "../src/model.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const { meters, transformers, issues, tree } = normalize(fixture("export-sample.json").data, fixture("dts-sample.json").data);
const meter = (id: string) => meters.find((m) => m.meterId === id)!;

describe("normalize", () => {
  it("repairs a blank code when other meters agree on it", () => {
    expect(meter("J100011").hierarchy.circle).toEqual({ code: "C-06", name: "Circle 6" });
    expect(issues).toContainEqual(expect.objectContaining({ type: "blank_code_repaired", entity: "meter:J100011" }));
  });

  it("fills a blank name from the code", () => {
    expect(meter("J100162").hierarchy.feeder).toEqual({ code: "F-003", name: "Feeder 3" });
    expect(issues).toContainEqual(expect.objectContaining({ type: "blank_name_repaired", entity: "meter:J100162" }));
  });

  it("uses the transformer list as the authority for DT names and keeps the other name as an alias", () => {
    expect(meter("J100400").hierarchy.dt.name).toBe("Sanganer DT 7");
    expect(issues).toContainEqual(expect.objectContaining({ type: "name_conflict", entity: "meter:J100400" }));
    const dt7 = transformers.find((t) => t.code === "DT-007")!;
    expect(dt7).toMatchObject({ name: "Sanganer DT 7", aliases: ["Old Malviya Nagar Xfmr"], capacityKva: 63, meterCount: 2 });
  });

  it("reports codes that sit under more than one parent", () => {
    const f001 = issues.find((i) => i.type === "multiple_parents" && i.entity === "feeder:F-001");
    expect(f001?.detail).toContain("SS-01");
    expect(f001?.detail).toContain("SS-11");
  });

  it("builds a path-keyed tree, so a reused code appears once per parent", () => {
    const flatten = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
    const f001Nodes = flatten(tree).filter((n) => n.level === "feeder" && n.code === "F-001");
    expect(f001Nodes).toHaveLength(2);
  });

  it("keeps transformers that have no meters", () => {
    expect(transformers.find((t) => t.code === "DT-038")).toMatchObject({ meterCount: 0, capacityKva: 400 });
  });

  it("finds no feeder mismatches when meter paths agree with the transformer list", () => {
    expect(issues.filter((i) => i.type === "feeder_mismatch")).toEqual([]);
  });
});