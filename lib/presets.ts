import type { MappingRow, SideCfg, SystemCode, Table } from "./types";

/**
 * ชุดสูตรตั้งต้นของแต่ละระบบ — Target Field กลาง 4 ตัว: SKU, Location, Qty, BBDate
 * (ย้ายมาจาก DEFAULT_MAPPINGS ของเวอร์ชัน Streamlit)
 */
export const SYSTEM_MAPPINGS: Record<Exclude<SystemCode, "OTHER">, Record<string, SideCfg>> = {
  JDA: {
    SKU: { function: "FIRST", columns: ["SKU"] },
    Location: { function: "FIRST", columns: ["SLOT"] },
    Qty: { function: "SUM", columns: ["SLOT_SOH"] },
    BBDate: { function: "MIN", columns: ["EXP_DATE"] },
  },
  FC: {
    SKU: { function: "FIRST", columns: ["sku_id"] },
    Location: { function: "FIRST", columns: ["location_id"] },
    Qty: { function: "SUM", columns: ["binbalance_qtybal"] },
    BBDate: { function: "MIN", columns: ["exp_date"] },
  },
  MHT: {
    SKU: { function: "FIRST", columns: ["SKU"] },
    Location: { function: "FIRST", columns: ["Location"] },
    Qty: { function: "SUM", columns: ["On Hand"] },
    BBDate: { function: "MIN", columns: [] }, // MHT ไม่มีวันหมดอายุ
  },
};

export const TARGET_ORDER = ["SKU", "Location", "Qty", "BBDate"];

/** คอลัมน์ลายเซ็นของแต่ละระบบ ไว้ตรวจจับระบบจากหัวตารางไฟล์ */
const SIGNATURES: Record<Exclude<SystemCode, "OTHER">, string[]> = {
  FC: ["sku_id", "location_id", "binbalance_qtybal", "exp_date"],
  JDA: ["slot", "slot_soh", "exp_date", "sku"],
  MHT: ["on hand", "location", "sku"],
};

const lc = (s: string) => s.trim().toLowerCase();

/** เดาว่าตารางนี้มาจากระบบไหน — คืน null ถ้าไม่ชัดเจน */
export function detectSystem(columns: string[]): { system: SystemCode; score: number } | null {
  const set = new Set(columns.map(lc));
  let best: { system: SystemCode; score: number } | null = null;
  (Object.keys(SIGNATURES) as Exclude<SystemCode, "OTHER">[]).forEach((sys) => {
    const sig = SIGNATURES[sys];
    const hit = sig.filter((c) => set.has(c)).length;
    const score = hit / sig.length;
    // ต้องตรงคอลัมน์เฉพาะระบบอย่างน้อย 2 ตัว และอย่างน้อย 60%
    if (hit >= 2 && score >= 0.6 && (!best || score > best.score)) best = { system: sys, score };
  });
  return best;
}

export interface Preset {
  rows: MappingRow[];
  /** Compare Fields ที่แนะนำ (ถ้า undefined = ทุกฟิลด์ร่วม) */
  compareFields?: string[];
  title: string;
  note?: string;
}

let idCounter = 0;
const newId = () => `r${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function cloneCfg(c: SideCfg | undefined): SideCfg {
  return c ? { ...c, columns: [...c.columns] } : { function: "FIRST", columns: [] };
}

/** เดาคอลัมน์จากชื่อ สำหรับระบบ "อื่น ๆ" */
const GUESS: Record<string, { re: RegExp; fn: SideCfg["function"] }> = {
  SKU: { re: /(^sku$|sku[_ ]?(id|code)?|item|material|product|รหัสสินค้า|รหัส)/i, fn: "FIRST" },
  Location: { re: /(location|loc$|slot|bin|ตำแหน่ง|ที่เก็บ)/i, fn: "FIRST" },
  Qty: { re: /(qty|quantity|on[ _]?hand|soh|balance|bal$|จำนวน|คงเหลือ)/i, fn: "SUM" },
  BBDate: { re: /(exp|expiry|expire|best[ _]?before|bbd|bb[ _]?date|วันหมดอายุ|หมดอายุ)/i, fn: "MIN" },
};

export function guessSide(target: string, cols: string[]): SideCfg {
  const g = GUESS[target];
  if (!g) return { function: "FIRST", columns: [] };
  const hit = cols.find((c) => g.re.test(c));
  return { function: g.fn, columns: hit ? [hit] : [] };
}

export function buildPreset(sysA: SystemCode, sysB: SystemCode, colsA: string[] = [], colsB: string[] = []): Preset {
  const sideCfg = (sys: SystemCode, target: string, cols: string[]) =>
    sys === "OTHER" ? guessSide(target, cols) : cloneCfg(SYSTEM_MAPPINGS[sys][target]);

  const rows: MappingRow[] = TARGET_ORDER.map((t) => ({
    id: newId(),
    target: t,
    a: sideCfg(sysA, t, colsA),
    b: sideCfg(sysB, t, colsB),
  }));

  const noDate = sysA === "MHT" || sysB === "MHT";
  const title =
    sysA === "OTHER" || sysB === "OTHER"
      ? `ชุดสูตรตั้งต้น ${sysA} ↔ ${sysB} (เดาคอลัมน์จากชื่อ — ตรวจสอบอีกครั้ง)`
      : `ชุดสูตรตั้งต้น ${sysA} ↔ ${sysB}`;
  return {
    rows,
    title,
    compareFields: noDate ? ["Qty"] : undefined,
    note: noDate ? "MHT ไม่มีคอลัมน์วันหมดอายุ จึงเลือกเทียบเฉพาะ Qty เป็นค่าเริ่มต้น (เลือก BBDate เพิ่มได้ในขั้น Compare)" : undefined,
  };
}

/** หาชื่อคอลัมน์จริงในไฟล์ที่ตรงกับชื่อในสูตร (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) */
export function resolveColumn(name: string, cols: string[]): string | null {
  if (cols.includes(name)) return name;
  const t = lc(name);
  return cols.find((c) => lc(c) === t) ?? null;
}

/** ปรับชื่อคอลัมน์ในสูตรให้ตรงกับไฟล์จริง */
export function fitRowsToColumns(rows: MappingRow[], colsA: string[], colsB: string[]): MappingRow[] {
  const fit = (cfg: SideCfg, cols: string[]): SideCfg => {
    if (cols.length === 0) return cfg;
    const fixOne = (c?: string | null) => (c ? resolveColumn(c, cols) ?? c : c);
    return {
      ...cfg,
      columns: cfg.columns.map((c) => resolveColumn(c, cols) ?? c),
      criteria_column: fixOne(cfg.criteria_column),
      criteria_column2: fixOne(cfg.criteria_column2),
    };
  };
  return rows.map((r) => ({ ...r, a: fit(r.a, colsA), b: fit(r.b, colsB) }));
}

export interface Coverage {
  rowId: string;
  target: string;
  side: "a" | "b";
  missing: string[];
}

/** ตรวจว่าคอลัมน์ที่สูตรอ้างถึงมีอยู่ในไฟล์จริงหรือไม่ */
export function coverage(rows: MappingRow[], colsA: string[], colsB: string[]): Coverage[] {
  const out: Coverage[] = [];
  for (const r of rows) {
    for (const side of ["a", "b"] as const) {
      const cols = side === "a" ? colsA : colsB;
      if (cols.length === 0) continue;
      const cfg = r[side];
      const used = [...cfg.columns, cfg.criteria_column, cfg.criteria_column2].filter(Boolean) as string[];
      const missing = used.filter((c) => !cols.includes(c));
      if (missing.length) out.push({ rowId: r.id, target: r.target, side, missing });
    }
  }
  return out;
}

export function tableColumns(t: Table | null | undefined): string[] {
  return t ? t.columns : [];
}
