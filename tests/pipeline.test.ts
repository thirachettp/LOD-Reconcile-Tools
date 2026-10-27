import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { compareTables } from "../lib/compare";
import { buildResultWorkbook } from "../lib/export-xlsx";
import { buildStandard } from "../lib/formulas";
import { loadFile, readCombined } from "../lib/io";
import { buildPreset, detectSystem, fitRowsToColumns } from "../lib/presets";

function xlsxBuf(aoa: unknown[][], sheet = "Sheet1"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wb.SheetNames.includes(sheet) ? ws : ws, sheet);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

describe("pipeline: MHT (csv) vs FC (xlsx)", () => {
  it("อ่านไฟล์ → ตรวจระบบ → สูตรตั้งต้น → compare → export", async () => {
    const mhtCsv = "SKU,Location,On Hand\n001,L1,5\n001,L1,5\n002,L2,\"1,000\"\n9,L9,1\n";
    const mhtBuf = new TextEncoder().encode(mhtCsv).buffer as ArrayBuffer;
    const fcBuf = xlsxBuf([
      ["sku_id", "location_id", "binbalance_qtybal", "exp_date"],
      ["001", "L1", 10, "2026-07-17"],
      ["002", "L2", 999, "17/07/2026"],
      ["3", "L3", 4, null],
    ]);

    const mhtInfo = loadFile("m", "mht.csv", mhtBuf.byteLength, mhtBuf);
    const fcInfo = loadFile("f", "fc.xlsx", fcBuf.byteLength, fcBuf);
    expect(mhtInfo.isExcel).toBe(false);
    expect(fcInfo.sheets).toEqual(["Sheet1"]);

    const mht = readCombined([{ fileId: "m", sheet: null, headerRow: 1 }]).table;
    const fc = readCombined([{ fileId: "f", sheet: "Sheet1", headerRow: 1 }]).table;
    expect(mht.rows.length).toBe(4);
    expect(detectSystem(mht.columns)?.system).toBe("MHT");
    expect(detectSystem(fc.columns)?.system).toBe("FC");

    const preset = buildPreset("MHT", "FC", mht.columns, fc.columns);
    const rows = fitRowsToColumns(preset.rows, mht.columns, fc.columns);
    const a = buildStandard(mht, rows, "a", "MHT");
    const b = buildStandard(fc, rows, "b", "FC");
    expect(a.warnings).toEqual([]);

    const res = compareTables(a.table, b.table, ["SKU", "Location"], preset.compareFields!, {
      fuzzyKeys: false,
      tolerance: 0,
      tagA: "MHT",
      tagB: "FC",
    });
    expect(res.summary).toMatchObject({ total: 4, match: 1, mismatch: 1, missingA: 1, missingB: 1, duplicateKeysA: 1 });
    // "1,000" ใน CSV ต้องอ่านเป็น 1000 → ต่างจาก 999 อยู่ 1
    const r002 = res.rows.find((r) => r[0] === "002")!;
    expect(r002[res.columns.indexOf("Qty_Diff")]).toBe(1);

    const out = await buildResultWorkbook(res);
    const wb = XLSX.read(new Uint8Array(out), { type: "array" });
    expect(wb.SheetNames).toEqual(["Summary", "All", "Match", "Mismatch", "Missing A", "Missing B"]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Mismatch"]).length).toBe(1);
  });

  it("แถว Header ไม่ใช่แถวแรก + คอลัมน์ซ้ำ", () => {
    const buf = xlsxBuf([["รายงานสต็อก"], [], ["SKU", "Qty", "Qty"], ["a", 1, 2]]);
    loadFile("h", "h.xlsx", buf.byteLength, buf);
    const t = readCombined([{ fileId: "h", sheet: "Sheet1", headerRow: 3 }]).table;
    expect(t.columns).toEqual(["SKU", "Qty", "Qty.1"]);
    expect(t.rows.length).toBe(1);
  });

  it("รวมหลายไฟล์ที่คอลัมน์ไม่เท่ากัน", () => {
    const b1 = new TextEncoder().encode("SKU,Qty\na,1\n").buffer as ArrayBuffer;
    const b2 = new TextEncoder().encode("SKU,Qty,Note\nb,2,x\n").buffer as ArrayBuffer;
    loadFile("c1", "1.csv", b1.byteLength, b1);
    loadFile("c2", "2.csv", b2.byteLength, b2);
    const t = readCombined([
      { fileId: "c1", sheet: null, headerRow: 1 },
      { fileId: "c2", sheet: null, headerRow: 1 },
    ]).table;
    expect(t.columns).toEqual(["SKU", "Qty", "Note"]);
    expect(t.rows).toEqual([["a", "1", null], ["b", "2", "x"]]);
  });
});

describe("วันที่ใน Excel ไม่ขึ้นกับ timezone", () => {
  // เขียนเลข serial + รูปแบบเซลล์ตรง ๆ (เหมือนไฟล์ Excel จริง) เพื่อทดสอบเฉพาะฝั่งอ่าน
  const serial = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0) =>
    Date.UTC(y, m - 1, d) / 86_400_000 + 25569 + (hh * 3600 + mm * 60 + ss) / 86_400;

  it("อ่านเลข serial + รูปแบบเซลล์ → YYYY-MM-DD (รวมค่าที่มีเวลาช่วงบ่าย)", () => {
    const ws: XLSX.WorkSheet = {
      A1: { t: "s", v: "D" },
      A2: { t: "n", v: serial(2026, 7, 1), z: "yyyy-mm-dd" },
      A3: { t: "n", v: serial(2026, 7, 1, 14, 32), z: "yyyy-mm-dd hh:mm" },
      A4: { t: "n", v: serial(2026, 12, 31, 23, 59, 30), z: "yyyy-mm-dd hh:mm:ss" },
      A5: { t: "n", v: 12345, z: "General" },
      A6: { t: "n", v: serial(2026, 1, 5), z: "dd/mm/yyyy" },
      "!ref": "A1:A6",
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    loadFile("dt", "dt.xlsx", buf.byteLength, buf);
    const t = readCombined([{ fileId: "dt", sheet: "S", headerRow: 1 }]).table;
    expect(t.rows.map((r) => r[0])).toEqual(["2026-07-01", "2026-07-01 14:32", "2026-12-31 23:59:30", 12345, "2026-01-05"]);
  });
});
