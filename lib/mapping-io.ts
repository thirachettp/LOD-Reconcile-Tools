import type { MappingRow, SideCfg, SystemCode } from "./types";

/** รูปแบบไฟล์ Mapping JSON — เข้ากันได้กับที่ export จากเวอร์ชัน Streamlit */
export interface MappingFile {
  name?: string;
  sys_a?: string;
  sys_b?: string;
  compare_keys?: string[];
  compare_fields?: string[];
  formulas: { target: string; a: SideCfg; b: SideCfg }[];
}

export function exportMapping(
  sysA: SystemCode,
  sysB: SystemCode,
  rows: MappingRow[],
  extra: { name?: string | null; keys?: string[]; fields?: string[] } = {},
): string {
  const payload: MappingFile = {
    ...(extra.name ? { name: extra.name } : {}),
    sys_a: sysA,
    sys_b: sysB,
    ...(extra.keys?.length ? { compare_keys: extra.keys } : {}),
    ...(extra.fields?.length ? { compare_fields: extra.fields } : {}),
    formulas: rows.map((r) => ({ target: r.target, a: r.a, b: r.b })),
  };
  return JSON.stringify(payload, null, 2);
}

function cleanSide(x: Partial<SideCfg> | undefined): SideCfg {
  const s = x ?? {};
  return {
    ...s,
    function: s.function ?? "FIRST",
    columns: Array.isArray(s.columns) ? [...s.columns] : [],
  };
}

export function importMapping(text: string): {
  rows: MappingRow[];
  sysA?: string;
  sysB?: string;
  name?: string;
  keys?: string[];
  fields?: string[];
} {
  const data = JSON.parse(text) as MappingFile;
  if (!data || !Array.isArray(data.formulas)) throw new Error("ไม่ใช่ไฟล์ Mapping ที่ถูกต้อง");
  const rows: MappingRow[] = data.formulas.map((f, i) => ({
    id: `imp${Date.now().toString(36)}${i}`,
    target: f.target ?? "",
    a: cleanSide(f.a),
    b: cleanSide(f.b),
  }));
  return { rows, sysA: data.sys_a, sysB: data.sys_b, name: data.name, keys: data.compare_keys, fields: data.compare_fields };
}
