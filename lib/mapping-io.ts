import type { MappingRow, SideCfg, SystemCode } from "./types";

/** รูปแบบไฟล์ Mapping JSON — เข้ากันได้กับที่ export จากเวอร์ชัน Streamlit */
export interface MappingFile {
  sys_a?: string;
  sys_b?: string;
  formulas: { target: string; a: SideCfg; b: SideCfg }[];
}

export function exportMapping(sysA: SystemCode, sysB: SystemCode, rows: MappingRow[]): string {
  const payload: MappingFile = {
    sys_a: sysA,
    sys_b: sysB,
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

export function importMapping(text: string): { rows: MappingRow[]; sysA?: string; sysB?: string } {
  const data = JSON.parse(text) as MappingFile;
  if (!data || !Array.isArray(data.formulas)) throw new Error("ไม่ใช่ไฟล์ Mapping ที่ถูกต้อง");
  const rows: MappingRow[] = data.formulas.map((f, i) => ({
    id: `imp${Date.now().toString(36)}${i}`,
    target: f.target ?? "",
    a: cleanSide(f.a),
    b: cleanSide(f.b),
  }));
  return { rows, sysA: data.sys_a, sysB: data.sys_b };
}
