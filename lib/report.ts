import type { CompareResult, RunInfo, SideInfo } from "./types";

export interface ReportItem {
  id: string;
  title: string;
  keys: string[];
  fields: string[];
  status: string;
  /** บรรทัดยอดรวมต่อฟิลด์ (แสดงเมื่อเลือก "แสดงยอดรวม") */
  totals: string[];
}

/** B เป็นกี่ % ของ A (ทศนิยม 2 ตำแหน่ง) */
const pct = (a: number | null, b: number | null) => (a === null || b === null || a === 0 ? "-" : `${((b / a) * 100).toFixed(2)} %`);

const n = (x: number | null) => (x === null ? "-" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** ชื่อฝั่งสำหรับหัวข้อ: ระบบ (FC/JDA/MHT) หรือชื่อไฟล์แรก (ตัดนามสกุล) ถ้าเป็นระบบอื่น */
export function defaultSideName(side: SideInfo): string {
  if (side.system && side.system !== "OTHER" && side.system !== "อื่น ๆ") return side.system;
  const f = side.files[0];
  return f ? f.replace(/\.[^.]+$/, "") : side.system || "-";
}

/** ชื่อฝั่ง A/B สำหรับสรุป: ใช้ระบบที่เลือก (หรือชื่อที่พิมพ์/ชื่อไฟล์); ถ้าสองฝั่งชื่อซ้ำกันใช้ A / B */
export function sideNames(info?: Pick<RunInfo, "a" | "b"> | null): [string, string] {
  if (!info) return ["A", "B"];
  const a = defaultSideName(info.a);
  const b = defaultSideName(info.b);
  return !a || !b || a === "-" || b === "-" || a === b ? ["A", "B"] : [a, b];
}

export function makeItem(res: Pick<CompareResult, "keys" | "fields" | "summary"> & { info?: RunInfo | null }, title: string): ReportItem {
  const s = res.summary;
  const [nA, nB] = sideNames(res.info);
  const bad = s.mismatch + s.missingA + s.missingB;
  const status =
    bad === 0
      ? "Match"
      : `Not Match (Mismatch ${s.mismatch.toLocaleString()}, Missing ${nA} ${s.missingA.toLocaleString()}, Missing ${nB} ${s.missingB.toLocaleString()} จาก ${s.total.toLocaleString()} Key, Match ${s.total ? ((s.match / s.total) * 100).toFixed(2) : "0.00"} %)`;
  const totals = [`Rows: ${s.rowsA.toLocaleString()} vs ${s.rowsB.toLocaleString()} (${pct(s.rowsA, s.rowsB)})`];
  for (const f of s.perField) {
    if (f.kind === "number") totals.push(`${f.name}: ${n(f.sumA)} vs ${n(f.sumB)} (${pct(f.sumA, f.sumB)})`);
  }
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    keys: res.keys,
    fields: res.fields.map((f) => f.name),
    status,
    totals,
  };
}

export function reportText(items: ReportItem[], withTotals: boolean): string {
  const out = ["ขออนุญาตสรุปการ Reconcile Stock ดังนี้", ""];
  items.forEach((it, i) => {
    out.push(`${i + 1}. ${it.title}`);
    out.push(`Keys : ${it.keys.join(", ")}`);
    out.push(`Compare : ${it.fields.join(", ")}`);
    if (withTotals) for (const t of it.totals) out.push(`   ${t}`);
    out.push(`Status : ${it.status}`);
    out.push("");
  });
  return out.join("\n").trimEnd() + "\n";
}
