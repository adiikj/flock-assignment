import { LEVELS, type Level, type Meter, type NodeRef, type Transformer, type TreeNode, type DataIssue } from "../model.js";
import { toNumber, type RawExportRow, type RawDt } from "../portal/parse.js";

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Counts values per key, most common first. e.g. "dt|DT-007" → ["Sanganer DT 7", "Old Malviya Nagar Xfmr"] */
class Tally {
  private map = new Map<string, Map<string, number>>();
  add(key: string, value: string) {
    const counts = this.map.get(key) ?? new Map<string, number>();
    counts.set(value, (counts.get(value) ?? 0) + 1);
    this.map.set(key, counts);
  }
  values(key: string): string[] {
    return [...(this.map.get(key) ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => value);
  }
  keys() {
    return [...this.map.keys()];
  }
}

/**
 * Turns raw export rows + the transformer list into the clean dataset.
 * Rule of thumb: repair only when the data leaves exactly one answer, and log every change.
 */
export function normalize(rows: RawExportRow[], dtMaster: RawDt[]) {
  const issues: DataIssue[] = [];
  const masterByCode = new Map(dtMaster.map((d) => [d.code.trim(), d]));
  const namesByCode = new Tally();
  const codesByName = new Tally();

  // Pass 1: learn name <-> code pairs from rows where both are present
  for (const row of rows) {
    for (const level of LEVELS) {
      const code = clean(row.hierarchy?.[level]?.code);
      const name = clean(row.hierarchy?.[level]?.name);
      if (code && name) {
        namesByCode.add(`${level}|${code}`, name);
        codesByName.add(`${level}|${name}`, code);
      }
    }
  }

  // Pass 2: clean meters
  const meters: Meter[] = rows.map((row) => {
    const entity = `meter:${row.meterId}`;
    const hierarchy = {} as Record<Level, NodeRef>;

    for (const level of LEVELS) {
      let code = clean(row.hierarchy?.[level]?.code);
      let name = clean(row.hierarchy?.[level]?.name);

      if (!code && name) {
        const candidates = codesByName.values(`${level}|${name}`);
        if (candidates.length === 1) {
          code = candidates[0];
          issues.push({ type: "blank_code_repaired", entity, detail: `${level} "${name}" had no code; inferred ${code} from other meters` });
        } else {
          issues.push({ type: "blank_code_unresolved", entity, detail: `${level} "${name}" has no code` });
        }
      }

      if (code) {
        // The transformer list is the authority for DT names; elsewhere, the most common name wins
        const canonical =
          (level === "dt" ? clean(masterByCode.get(code)?.name) : null) ?? namesByCode.values(`${level}|${code}`)[0];
        if (canonical && !name) {
          issues.push({ type: "blank_name_repaired", entity, detail: `${level} ${code} had no name; using "${canonical}"` });
        } else if (canonical && name !== canonical) {
          issues.push({ type: "name_conflict", entity, detail: `${level} ${code} is "${name}" here; canonical name is "${canonical}"` });
        }
        name = canonical ?? name;
      }

      hierarchy[level] = { code, name };
    }

    const dtCode = clean(row.dtCode);
    if (dtCode !== hierarchy.dt.code) {
      issues.push({ type: "dt_code_mismatch", entity, detail: `dtCode ${dtCode} but hierarchy says ${hierarchy.dt.code}` });
    }

    const lat = toNumber(row.geo?.lat);
    const lng = toNumber(row.geo?.lng);
    const validLocation = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (!validLocation) {
      issues.push({ type: "invalid_location", entity, detail: `geo = ${JSON.stringify(row.geo)}` });
    }

    return {
      meterId: row.meterId.trim(),
      serialNo: clean(row.serialNo),
      make: clean(row.make),
      phaseType: clean(row.phaseType),
      installStatus: clean(row.installStatus),
      installType: clean(row.installType),
      build: clean(row.build),
      dtCode,
      hierarchy,
      location: validLocation ? { lat: lat!, lng: lng! } : null,
    };
  });

  // Pass 3: codes that sit under more than one parent (e.g. D-01 under C-01, C-05 and C-03)
  const parents = new Tally();
  for (const m of meters) {
    LEVELS.slice(1).forEach((level, i) => {
      const child = m.hierarchy[level].code;
      const parent = m.hierarchy[LEVELS[i]].code;
      if (child && parent) parents.add(`${level}|${child}`, parent);
    });
  }
  for (const key of parents.keys()) {
    const seen = parents.values(key);
    if (seen.length > 1) {
      const [level, code] = key.split("|");
      issues.push({ type: "multiple_parents", entity: `${level}:${code}`, detail: `appears under ${seen.join(", ")}` });
    }
  }

  // Transformers: the master list, cross-checked against what each meter says
  const meterCountByDt = new Map<string, number>();
  for (const m of meters) {
    const code = m.hierarchy.dt.code;
    if (!code) continue;
    meterCountByDt.set(code, (meterCountByDt.get(code) ?? 0) + 1);

    const master = masterByCode.get(code);
    if (!master) {
      issues.push({ type: "dt_not_in_master", entity: `meter:${m.meterId}`, detail: `DT ${code} is not in the transformer list` });
    } else if (clean(master.feederCode) !== m.hierarchy.feeder.code) {
      issues.push({
        type: "feeder_mismatch",
        entity: `meter:${m.meterId}`,
        detail: `meter path says feeder ${m.hierarchy.feeder.code}; transformer list says ${master.feederCode} for ${code}`,
      });
    }
  }

  const allDtCodes = new Set([...masterByCode.keys(), ...meterCountByDt.keys()]);
  const transformers: Transformer[] = [...allDtCodes].sort().map((code) => {
    const master = masterByCode.get(code);
    const name = clean(master?.name) ?? namesByCode.values(`dt|${code}`)[0] ?? null;
    return {
      code,
      name,
      aliases: namesByCode.values(`dt|${code}`).filter((n) => n !== name),
      feederCode: clean(master?.feederCode) ?? parents.values(`dt|${code}`)[0] ?? null,
      capacityKva: toNumber(master?.capacityKva),
      meterCount: meterCountByDt.get(code) ?? 0,
    };
  });

  return { meters, transformers, tree: buildTree(meters), issues };
}

/** Tree keyed by full path, so a code reused under two parents becomes two nodes, as in the portal's breadcrumbs. */
function buildTree(meters: Meter[]): TreeNode[] {
  interface Building extends Omit<TreeNode, "children"> {
    children: Map<string, Building>;
  }
  const roots = new Map<string, Building>();

  for (const m of meters) {
    let siblings = roots;
    for (const level of LEVELS) {
      const { code, name } = m.hierarchy[level];
      const key = code ?? `unknown:${name ?? ""}`;
      let node = siblings.get(key);
      if (!node) {
        node = { level, code, name, meterCount: 0, children: new Map() };
        siblings.set(key, node);
      }
      node.meterCount++;
      siblings = node.children;
    }
  }

  const finish = (map: Map<string, Building>): TreeNode[] =>
    [...map.values()]
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))
      .map(({ children, ...node }) => ({ ...node, children: finish(children) }));

  return finish(roots);
}