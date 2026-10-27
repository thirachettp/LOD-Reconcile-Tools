import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { compareTables } from "../lib/compare";
import { buildResultWorkbook } from "../lib/export-xlsx";
import { applyFormula, buildStandard } from "../lib/formulas";
import {
  BUILTIN_MAPPINGS,
  NameTakenError,
  cloneRows,
  deleteMapping,
  listSaved,
  renameMapping,
  saveMapping,
} from "../lib/library";
import { exportMapping, importMapping } from "../lib/mapping-io";
import { coverage, fitRowsToColumns } from "../lib/presets";
import type { RunInfo, Table } from "../lib/types";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("FIRST หลายคอลัมน์ = ค่าแรกที่ไม่ว่าง", () => {
  const t: Table = {
    columns: ["sku_id", "IBC"],
    rows: [["A", null], [null, "B"], ["", "C"], [null, null]],
  };
  it("coalesce ข้ามช่องว่าง", () => {
    expect(applyFormula(t, { function: "FIRST", columns: ["sku_id", "IBC"] }, "t").values).toEqual(["A", "B", "C", null]);
  });
  it("ลำดับคอลัมน์มีผล", () => {
    expect(applyFormula({ columns: ["x", "y"], rows: [["1", "2"]] }, { function: "FIRST", columns: ["y", "x"] }, "t").values).toEqual(["2"]);
  });
});

describe("ฟิลด์ข้อความ", () => {
  const a: Table = { columns: ["SKU", "Lock Code", "Qty"], rows: [["1", "Q", 1], ["2", "", 1], ["3", "H", 1]] };
  const b: Table = { columns: ["SKU", "Lock Code", "Qty"], rows: [["1", "Q", 1], ["2", "H", 1], ["3", "h ", 1]] };
  const opts = { fuzzyKeys: false, tolerance: 0, tagA: "FC", tagB: "INI" };

  it("เทียบเป็นข้อความ ไม่ถูกมองเป็นตัวเลข 0", () => {
    const r = compareTables(a, b, ["SKU"], ["Lock Code", "Qty"], opts);
    const f = r.fields.find((x) => x.name === "Lock Code")!;
    expect(f.kind).toBe("text");
    expect(f.colDiff).toBeNull();
    expect(r.columns).not.toContain("Lock Code_Diff");
    expect(r.columns).toContain("Qty_Diff");
    const by = Object.fromEntries(r.rows.map((x) => [x[0], x[r.statusCol]]));
    expect(by).toEqual({ "1": "Match", "2": "Mismatch", "3": "Mismatch" }); // "H" ≠ "h " (trim แล้วยังต่างตัวพิมพ์)
    expect(r.summary.perField[0].rowsDiff).toBe(2);
  });
  it("จับคู่หลวม = ไม่สนตัวพิมพ์", () => {
    const r = compareTables(a, b, ["SKU"], ["Lock Code"], { ...opts, fuzzyKeys: true });
    expect(r.rows.find((x) => x[0] === "3")![r.statusCol]).toBe("Match");
  });
  it("ข้อความว่างทั้งสองฝั่ง = Match", () => {
    const x: Table = { columns: ["SKU", "Lock Code"], rows: [["1", null], ["2", "A"]] };
    const y: Table = { columns: ["SKU", "Lock Code"], rows: [["1", ""], ["2", "A"]] };
    expect(compareTables(x, y, ["SKU"], ["Lock Code"], opts).summary.match).toBe(2);
  });
});

describe("คลัง Mapping (localStorage)", () => {
  const rows = BUILTIN_MAPPINGS[0].rows;
  const base = { sysA: "FC" as const, sysB: "OTHER" as const, rows };

  it("บันทึก → รายการ → บันทึกทับ → เปลี่ยนชื่อ → ลบ", () => {
    const st = memStore();
    const m1 = saveMapping({ ...base, name: "  งาน  A  ", compareKeys: ["SKU", "LPN"] }, st);
    expect(m1.name).toBe("งาน A");
    expect(listSaved(st)).toHaveLength(1);
    expect(listSaved(st)[0].compareKeys).toEqual(["SKU", "LPN"]);

    const m1b = saveMapping({ ...base, id: m1.id, name: "งาน A", compareKeys: ["SKU"] }, st);
    expect(m1b.id).toBe(m1.id);
    expect(listSaved(st)).toHaveLength(1);
    expect(listSaved(st)[0].compareKeys).toEqual(["SKU"]);

    const r = renameMapping(m1.id, "งาน B", st);
    expect(r.name).toBe("งาน B");

    deleteMapping(m1.id, st);
    expect(listSaved(st)).toEqual([]);
  });
  it("ชื่อซ้ำต้องยืนยันก่อนทับ (ไม่สนตัวพิมพ์)", () => {
    const st = memStore();
    const first = saveMapping({ ...base, name: "Daily" }, st);
    expect(() => saveMapping({ ...base, name: "daily" }, st)).toThrow(NameTakenError);
    const over = saveMapping({ ...base, name: "daily", overwrite: true }, st);
    expect(over.id).toBe(first.id);
    expect(listSaved(st)).toHaveLength(1);
  });
  it("เปลี่ยนชื่อชนกับของอื่นไม่ได้ / ชื่อว่าง / ชื่อตรงตัวอย่างในระบบ", () => {
    const st = memStore();
    saveMapping({ ...base, name: "One" }, st);
    const two = saveMapping({ ...base, name: "Two" }, st);
    expect(() => renameMapping(two.id, "one", st)).toThrow(NameTakenError);
    expect(() => saveMapping({ ...base, name: "   " }, st)).toThrow();
    expect(() => saveMapping({ ...base, name: "FC vs Initialstock" }, st)).toThrow(/ตัวอย่างในระบบ/);
  });
  it("storage ใช้ไม่ได้ → แจ้งข้อผิดพลาด ไม่ crash ตอนอ่าน", () => {
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("full"); } };
    expect(listSaved(broken)).toEqual([]);
    expect(() => saveMapping({ ...base, name: "x" }, broken)).toThrow(/บันทึกไม่สำเร็จ/);
  });
  it("cloneRows ให้ id ใหม่และไม่แชร์ object", () => {
    const c = cloneRows(rows);
    expect(c[0].id).not.toBe(rows[0].id);
    c[0].a.columns.push("zzz");
    expect(rows[0].a.columns).not.toContain("zzz");
  });
});

describe("ไฟล์ Mapping_FC_OTHER.json ของผู้ใช้", () => {
  const json = readFileSync(new URL("../tests/fixtures/Mapping_FC_OTHER.json", import.meta.url), "utf8");

  it("นำเข้าได้ และ export กลับแล้วเหมือนเดิม", () => {
    const imp = importMapping(json);
    expect(imp.sysA).toBe("FC");
    expect(imp.sysB).toBe("OTHER");
    expect(imp.rows.map((r) => r.target)).toEqual(["SKU", "Location", "LPN", "Lock Code", "Qty_total", "Receiving date"]);
    const again = importMapping(exportMapping("FC", "OTHER", imp.rows, { name: "x", keys: ["SKU"] }));
    expect(again.rows.map((r) => [r.target, r.a, r.b])).toEqual(imp.rows.map((r) => [r.target, r.a, r.b]));
    expect(again.keys).toEqual(["SKU"]);
  });

  it("ชื่อคอลัมน์ที่มี \\n ท้ายจับคู่กับหัวตารางจริง (มี/ไม่มี \\n) ได้", () => {
    const imp = importMapping(json);
    const colsA = ["sku_id", "Location ID", "LPN No.", "exp_date", "Lock Code", "Stock on Hand", "Receiving date"]; // ไม่มี \n
    const colsB = ["ITEM_NO", "Location_Id", "LPN_NO", "Lockcode", "Qty", "GR_Date"];
    const fitted = fitRowsToColumns(imp.rows, colsA, colsB);
    expect(fitted.find((r) => r.target === "Location")!.a.columns).toContain("Location ID");
    expect(fitted.find((r) => r.target === "LPN")!.a.columns).toContain("LPN No.");
    // coverage เหลือเฉพาะคอลัมน์ที่ไม่มีในไฟล์จริง (sku_id/location_id ฯลฯ ที่อีกรูปแบบไฟล์ใช้)
    const missing = coverage(fitted, colsA, colsB).flatMap((c) => c.missing);
    expect(missing).toContain("IBC");
    expect(missing).not.toContain("Location ID");
  });

  it("ตัวอย่างในระบบ FC vs Initialstock เทียบกันได้ครบทุกชนิดฟิลด์", async () => {
    const m = BUILTIN_MAPPINGS[0];
    const fc: Table = {
      columns: ["IBC", "Location ID", "LPN No.", "Lock Code", "Stock on Hand", "Receiving date"],
      rows: [
        ["SKU1", "L1", "LPN1", "Q", 10, "17/07/2026"],
        ["SKU2", "L1", "LPN2", null, 5, "01/08/2026"],
        ["SKU3", "L2", "LPN3", "H", 7, "02/08/2026"],
      ],
    };
    const ini: Table = {
      columns: ["ITEM_NO", "Location_Id", "LPN_NO", "Lockcode", "Qty", "GR_Date"],
      rows: [
        ["SKU1", "L1", "LPN1", "Q", 10, "2026-07-17"],
        ["SKU2", "L1", "LPN2", "Q", 4, "2026-08-01"],
        ["SKU4", "L9", "LPN9", null, 1, "2026-08-03"],
      ],
    };
    const rows = fitRowsToColumns(cloneRows(m.rows), fc.columns, ini.columns);
    const a = buildStandard(fc, rows, "a", "FC");
    const b = buildStandard(ini, rows, "b", "INI");
    expect(a.table.rows[0]).toEqual(["SKU1", "L1", "LPN1", "Q", 10, "2026-07-17"]);

    const res = compareTables(a.table, b.table, ["SKU", "LPN"], ["Location", "Lock Code", "Qty_total", "Receiving date"], {
      fuzzyKeys: false,
      tolerance: 0,
      tagA: "FC",
      tagB: "INI",
    });
    const by = Object.fromEntries(res.rows.map((r) => [r[0], [r[res.statusCol], r[res.mismatchedCol]]]));
    expect(by["SKU1"]).toEqual(["Match", ""]);
    expect(by["SKU2"]).toEqual(["Mismatch", "Lock Code, Qty_total"]);
    expect(by["SKU3"][0]).toBe("Missing B");
    expect(by["SKU4"][0]).toBe("Missing A");

    // สรุประบบ + ชื่อไฟล์ใน Excel
    res.info = {
      mappingName: m.name,
      a: { system: "FC", files: ["fc_stock.xlsx [Sheet1, Sheet2]"], rowCount: 3 },
      b: { system: "อื่น ๆ", files: ["initialstock.csv"], rowCount: 3 },
      generatedAt: new Date(2026, 9, 27, 16, 30).toISOString(),
      tolerance: 0,
      fuzzyKeys: false,
    } satisfies RunInfo;
    const wb = XLSX.read(new Uint8Array(await buildResultWorkbook(res)), { type: "array" });
    const text = (XLSX.utils.sheet_to_json(wb.Sheets["Summary"], { header: 1 }) as unknown[][]).map((r) => r.join(" | ")).join("\n");
    expect(text).toContain("fc_stock.xlsx [Sheet1, Sheet2]");
    expect(text).toContain("initialstock.csv");
    expect(text).toContain("FC vs Initialstock");
    expect(text).toContain("Key Columns | SKU, LPN");
    expect(text).toContain("2026-10-27 16:30");
    expect(wb.SheetNames).toEqual(["Summary", "All", "Match", "Mismatch", "Missing A", "Missing B"]);
  });
});
