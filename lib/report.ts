import type { CompareResult, SideInfo } from "./types";

export interface ReportItem {
  id: string;
  title: string;
  keys: string[];
  fields: string[];
  status: string;
  /** บรรทัดยอดรวมต่อฟิลด์ (แสดงเมื่อเลือก "แสดงยอดรวม") */
  totals: string[];
}

const n = (x: number | null) => (x === null ? "-" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** ชื่อฝั่งสำหรับหัวข้อ: ระบบ (FC/JDA/MHT) หรือชื่อไฟล์แรก (ตัดนามสกุล) ถ้าเป็นระบบอื่น */
export function defaultSideName(side: SideInfo): string {
  if (side.system && side.system !== "OTHER" && side.system !== "อื่น ๆ") return side.system;
  const f = side.files[0];
  return f ? f.replace(/\.[^.]+$/, "") : side.system || "-";
}

export function makeItem(res: Pick<CompareResult, "keys" | "fields" | "summary">, title: string): ReportItem {
  const s = res.summary;
  const bad = s.mismatch + s.missingA + s.missingB;
  const status =
    bad === 0
      ? "Match"
      : `Not Match (Mismatch ${s.mismatch.toLocaleString()}, Missing A ${s.missingA.toLocaleString()}, Missing B ${s.missingB.toLocaleString()} จาก ${s.total.toLocaleString()} Key)`;
  const totals = [`Rows: ${s.rowsA.toLocaleString()} vs ${s.rowsB.toLocaleString()}`];
  for (const f of s.perField) {
    if (f.kind === "number") totals.push(`${f.name}: ${n(f.sumA)} vs ${n(f.sumB)}`);
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
