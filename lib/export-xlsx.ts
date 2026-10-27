import ExcelJS from "exceljs";
import type { Cell, CompareResult } from "./types";

const STATUSES = ["Match", "Mismatch", "Missing A", "Missing B"] as const;

function colWidth(header: string, rows: Cell[][], idx: number): number {
  let m = header.length;
  const lim = Math.min(rows.length, 500);
  for (let i = 0; i < lim; i++) {
    const v = rows[i][idx];
    const l = v === null || v === undefined ? 0 : String(v).length;
    if (l > m) m = l;
  }
  return Math.min(m + 4, 40);
}

const p2 = (n: number) => String(n).padStart(2, "0");
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function fileList(files: string[]): string {
  return files.length ? files.join("\n") : "-";
}

/** สร้างไฟล์ Excel 6 sheet: Summary, All, Match, Mismatch, Missing A, Missing B */
export async function buildResultWorkbook(res: CompareResult): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const s = res.summary;
  const info = res.info;
  const pct = (n: number) => (s.total ? `${((n / s.total) * 100).toFixed(1)}%` : "0%");

  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 22 }, { width: 18 }, { width: 62 }, { width: 14 }];
  const head = (cells: (string | number)[]) => {
    const r = sum.addRow(cells);
    r.font = { bold: true };
    return r;
  };

  sum.addRow(["LOD · Reconcile Tools — สรุปผลการเทียบ"]).font = { bold: true, size: 14 };
  if (info) {
    sum.addRow(["สร้างเมื่อ", stamp(info.generatedAt)]);
    sum.addRow([]);
    head(["ฝั่ง", "ระบบ", "ไฟล์", "จำนวนแถวดิบ"]);
    for (const [label, side] of [["A", info.a], ["B", info.b]] as const) {
      const r = sum.addRow([`ฝั่ง ${label}`, side.system, fileList(side.files), side.rowCount]);
      r.alignment = { vertical: "top", wrapText: true };
    }
    sum.addRow([]);
    sum.addRow(["Mapping", info.mappingName ?? "-"]);
    sum.addRow(["Key Columns", res.keys.join(", ")]);
    sum.addRow(["Compare Fields", res.fields.map((f) => f.name).join(", ") || "-"]);
    sum.addRow(["ความต่างที่ยอมรับ (ตัวเลข)", info.tolerance]);
    sum.addRow(["จับคู่แบบหลวม", info.fuzzyKeys ? "ใช่" : "ไม่"]);
  }
  sum.addRow([]);
  head(["Metric", "Count", "Pct"]);
  sum.addRow(["Total Rows", s.total, "100%"]);
  sum.addRow(["Match", s.match, pct(s.match)]);
  sum.addRow(["Mismatch", s.mismatch, pct(s.mismatch)]);
  sum.addRow(["Missing A", s.missingA, pct(s.missingA)]);
  sum.addRow(["Missing B", s.missingB, pct(s.missingB)]);
  if (s.duplicateKeysA || s.duplicateKeysB) {
    sum.addRow([]);
    sum.addRow(["Key ซ้ำที่ถูกรวมยอด (A)", s.duplicateKeysA]);
    sum.addRow(["Key ซ้ำที่ถูกรวมยอด (B)", s.duplicateKeysB]);
  }
  if (s.perField.length) {
    sum.addRow([]);
    head(["Field", "Rows with diff", "Total |Diff|"]);
    for (const f of s.perField) {
      const label = f.name + (f.kind === "date" ? " (days)" : f.kind === "text" ? " (text)" : "");
      sum.addRow([label, f.rowsDiff, f.kind === "text" ? null : f.totalAbsDiff]);
    }
  }

  const diffIdx = res.fields.map((f) => (f.colDiff ? res.columns.indexOf(f.colDiff) : -1));

  const addSheet = (name: string, rows: Cell[][]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(res.columns).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of rows) ws.addRow(r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null)));
    res.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = colWidth(c, rows, i);
    });
    if (rows.length) {
      for (const di of diffIdx) {
        if (di < 0) continue;
        const letter = ws.getColumn(di + 1).letter;
        const ref = `${letter}2:${letter}${rows.length + 1}`;
        const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, bgColor: { argb } });
        ws.addConditionalFormatting({
          ref,
          rules: [
            { type: "cellIs", operator: "greaterThan", formulae: [0], priority: 1, style: { fill: fill("FFFEF9C3") } },
            { type: "cellIs", operator: "lessThan", formulae: [0], priority: 2, style: { fill: fill("FFFEE2E2") } },
            { type: "cellIs", operator: "equal", formulae: [0], priority: 3, style: { fill: fill("FFDCFCE7") } },
          ],
        });
      }
    }
  };

  addSheet("All", res.rows);
  for (const st of STATUSES) addSheet(st, res.rows.filter((r) => r[res.statusCol] === st));

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}
