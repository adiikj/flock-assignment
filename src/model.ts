export const LEVELS = ["zone", "circle", "division", "subdivision", "substation", "feeder", "dt"] as const;
export type Level = (typeof LEVELS)[number];

export interface NodeRef {
  code: string | null;
  name: string | null;
}

export interface Meter {
  meterId: string;
  serialNo: string | null;
  make: string | null;
  phaseType: string | null;     // "single" | "three"
  installStatus: string | null; // "Installed" | "Faulty" | "Decommissioned"
  installType: string | null;   // "Whole Current" | "CT Operated"
  build: string | null;         // "legacy" | "v2"
  dtCode: string | null;
  hierarchy: Record<Level, NodeRef>;
  location: { lat: number; lng: number } | null;
}

export interface Transformer {
  code: string;
  name: string | null;
  aliases: string[];          // other names seen for this code on meters
  feederCode: string | null;
  capacityKva: number | null;
  meterCount: number;
}

export interface TreeNode {
  level: Level;
  code: string | null;
  name: string | null;
  meterCount: number;
  children: TreeNode[];
}

export interface DataIssue {
  type:
    | "blank_code_repaired"
    | "blank_code_unresolved"
    | "blank_name_repaired"
    | "name_conflict"
    | "multiple_parents"
    | "dt_code_mismatch"
    | "invalid_location"
    | "dt_not_in_master"
    | "feeder_mismatch";
  entity: string; // e.g. "meter:J100011" or "feeder:F-001"
  detail: string;
}