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

/** สร้างไฟล์ Excel 6 sheet: Summary, All, Match, Mismatch, Missing A, Missing B */
export async function buildResultWorkbook(res: CompareResult): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const s = res.summary;
  const pct = (n: number) => (s.total ? `${((n / s.total) * 100).toFixed(1)}%` : "0%");

  const sum = wb.addWorksheet("Summary");
  sum.addRow(["Metric", "Count", "Pct"]).font = { bold: true };
  sum.addRow(["Total Rows", s.total, "100%"]);
  sum.addRow(["Match", s.match, pct(s.match)]);
  sum.addRow(["Mismatch", s.mismatch, pct(s.mismatch)]);
  sum.addRow(["Missing A", s.missingA, pct(s.missingA)]);
  sum.addRow(["Missing B", s.missingB, pct(s.missingB)]);
  sum.columns = [{ width: 18 }, { width: 12 }, { width: 10 }];
  if (s.perField.length) {
    sum.addRow([]);
    sum.addRow(["Field", "Rows with diff", "Total |Diff|"]).font = { bold: true };
    for (const f of s.perField) sum.addRow([f.name + (f.isDate ? " (days)" : ""), f.rowsDiff, f.totalAbsDiff]);
  }

  const diffIdx = res.fields.map((f) => res.columns.indexOf(f.colDiff));

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
