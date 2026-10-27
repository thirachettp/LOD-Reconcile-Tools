import { describe, expect, it } from "vitest";
import { compareTables } from "../lib/compare";
import { formatDay, isDateLike, parseDay, toNumber } from "../lib/dates";
import { applyFormula, buildStandard } from "../lib/formulas";
import { buildPreset, coverage, detectSystem, fitRowsToColumns } from "../lib/presets";
import type { SideCfg, Table } from "../lib/types";

const iso = (v: string, o: "dmy" | "mdy" | "ymd" = "dmy") => formatDay(parseDay(v, o));

describe("dates", () => {
  it("ISO ไม่ขึ้นกับ order", () => {
    expect(iso("2026-07-09", "dmy")).toBe("2026-07-09");
    expect(iso("2026-07-09 14:32:00", "mdy")).toBe("2026-07-09");
  });
  it("D/M/Y กำกวม อ่านตาม order", () => {
    expect(iso("03/04/2026", "dmy")).toBe("2026-04-03");
    expect(iso("03/04/2026", "mdy")).toBe("2026-03-04");
  });
  it("ค่าที่ชัดเจนอ่านถูกแม้ order ผิด", () => {
    expect(iso("17/7/2026", "mdy")).toBe("2026-07-17");
  });
  it("Y/M/D สองหลัก", () => {
    expect(iso("26/07/09", "ymd")).toBe("2026-07-09");
  });
  it("วันที่ไม่มีจริง = null", () => {
    expect(iso("31/02/2026")).toBeNull();
  });
  it("toNumber", () => {
    expect(toNumber("1,234.5")).toBe(1234.5);
    expect(toNumber("150 pcs")).toBeNull();
    expect(toNumber("")).toBeNull();
  });
  it("isDateLike", () => {
    expect(isDateLike(["17/7/2026", "1/8/2026"])).toBe(true);
    expect(isDateLike(["100", "200"])).toBe(false);
  });
});

const raw: Table = {
  columns: ["SKU", "LOC", "QTY", "STATUS", "EXP"],
  rows: [
    ["A", "L1", 10, "GOOD", "17/7/2026"],
    ["A", "L1", "5", "BAD", "1/8/2026"],
    ["B", "L2", "N/A", "GOOD", null],
  ],
};

describe("formulas", () => {
  it("SUM รวมและเตือนค่าที่ไม่ใช่ตัวเลข", () => {
    const r = applyFormula(raw, { function: "SUM", columns: ["QTY"] }, "t");
    expect(r.values).toEqual([10, 5, 0]);
    expect(r.warnings.length).toBe(1);
  });
  it("SUMIF = / IN / blank", () => {
    const base: SideCfg = { function: "SUMIF", columns: ["QTY"], criteria_column: "STATUS", operator: "==", criteria_mode: "const", criteria_value: "GOOD" };
    expect(applyFormula(raw, base, "t").values).toEqual([10, 0, 0]);
    expect(applyFormula(raw, { ...base, operator: "in_list", criteria_values: ["BAD"] }, "t").values).toEqual([0, 5, 0]);
    expect(applyFormula(raw, { ...base, criteria_column: "EXP", operator: "is_blank" }, "t").values).toEqual([0, 0, 0]);
  });
  it("MIN วันที่ → ISO", () => {
    expect(applyFormula(raw, { function: "MIN", columns: ["EXP"] }, "t").values).toEqual(["2026-07-17", "2026-08-01", null]);
  });
  it("COUNT", () => {
    expect(applyFormula(raw, { function: "COUNT", columns: ["QTY", "EXP"] }, "t").values).toEqual([2, 2, 1]);
  });
  it("ฟังก์ชันวันที่ภาษาไทยบังคับ order", () => {
    const t: Table = { columns: ["D"], rows: [["03/04/2026"]] };
    expect(applyFormula(t, { function: "ดวป", columns: ["D"] }, "t").values).toEqual(["2026-03-04"]);
    expect(applyFormula(t, { function: "วดป", columns: ["D"] }, "t").values).toEqual(["2026-04-03"]);
  });
});

describe("compare", () => {
  const a: Table = { columns: ["SKU", "Location", "Qty", "BBDate"], rows: [["1", "L1", 10, "2026-07-17"], ["1", "L1", 5, "2026-08-01"], ["2", "L2", 3, "2026-01-01"], ["4", "L9", 1, null]] };
  const b: Table = { columns: ["SKU", "Location", "Qty", "BBDate"], rows: [["1", "L1", 15, "2026-07-17"], ["2", "L2", 4, "2026-01-02"], ["3", "L3", 7, null]] };
  const opts = { fuzzyKeys: false, tolerance: 0, tagA: "A", tagB: "B" };

  it("status, diff, duplicates", () => {
    const r = compareTables(a, b, ["SKU", "Location"], ["Qty", "BBDate"], opts);
    const byKey = Object.fromEntries(r.rows.map((x) => [x[0] as string, x]));
    expect(byKey["1"][r.statusCol]).toBe("Match");
    expect(byKey["2"][r.statusCol]).toBe("Mismatch");
    expect(byKey["2"][r.mismatchedCol]).toBe("Qty, BBDate");
    expect(byKey["3"][r.statusCol]).toBe("Missing A");
    expect(byKey["4"][r.statusCol]).toBe("Missing B");
    expect(r.summary).toMatchObject({ total: 4, match: 1, mismatch: 1, missingA: 1, missingB: 1, duplicateKeysA: 1 });
  });
  it("tolerance", () => {
    const r = compareTables(a, b, ["SKU", "Location"], ["Qty"], { ...opts, tolerance: 1 });
    const row2 = r.rows.find((x) => x[0] === "2")!;
    expect(row2[r.statusCol]).toBe("Match");
  });
  it("fuzzy key", () => {
    const x: Table = { columns: ["SKU", "Qty"], rows: [[" ab ", 1]] };
    const y: Table = { columns: ["SKU", "Qty"], rows: [["AB", 1]] };
    expect(compareTables(x, y, ["SKU"], ["Qty"], opts).summary.match).toBe(0);
    expect(compareTables(x, y, ["SKU"], ["Qty"], { ...opts, fuzzyKeys: true }).summary.match).toBe(1);
  });
  it("วันที่ว่างทั้งคู่ไม่ถือว่าต่าง", () => {
    const x: Table = { columns: ["SKU", "BBDate"], rows: [["1", null]] };
    const y: Table = { columns: ["SKU", "BBDate"], rows: [["1", null]] };
    expect(compareTables(x, y, ["SKU"], ["BBDate"], opts).summary.match).toBe(1);
  });
});

describe("presets", () => {
  it("MHT vs FC ได้สูตรครบ 4 targets และเทียบเฉพาะ Qty", () => {
    const p = buildPreset("MHT", "FC");
    expect(p.rows.map((r) => r.target)).toEqual(["SKU", "Location", "Qty", "BBDate"]);
    expect(p.rows[2].a).toMatchObject({ function: "SUM", columns: ["On Hand"] });
    expect(p.rows[2].b).toMatchObject({ function: "SUM", columns: ["binbalance_qtybal"] });
    expect(p.compareFields).toEqual(["Qty"]);
  });
  it("FC vs JDA เทียบทุกฟิลด์", () => {
    expect(buildPreset("FC", "JDA").compareFields).toBeUndefined();
  });
  it("ตรวจจับระบบจากหัวตาราง", () => {
    expect(detectSystem(["sku_id", "location_id", "binbalance_qtybal", "x"])?.system).toBe("FC");
    expect(detectSystem(["SKU", "SLOT", "SLOT_SOH", "EXP_DATE"])?.system).toBe("JDA");
    expect(detectSystem(["SKU", "Location", "On Hand"])?.system).toBe("MHT");
    expect(detectSystem(["a", "b"])).toBeNull();
  });
  it("fit ชื่อคอลัมน์ไม่สนตัวพิมพ์ และ coverage แจ้งที่หายไป", () => {
    const p = buildPreset("MHT", "FC");
    const fitted = fitRowsToColumns(p.rows, ["sku", "location", "on hand"], ["SKU_ID", "LOCATION_ID", "BINBALANCE_QTYBAL", "EXP_DATE"]);
    expect(fitted[0].a.columns).toEqual(["sku"]);
    expect(fitted[0].b.columns).toEqual(["SKU_ID"]);
    expect(coverage(fitted, ["sku", "location", "on hand"], ["SKU_ID", "LOCATION_ID", "BINBALANCE_QTYBAL", "EXP_DATE"])).toEqual([]);
    expect(coverage(p.rows, ["x"], []).length).toBeGreaterThan(0);
  });
  it("build standard end-to-end MHT vs FC", () => {
    const mht: Table = { columns: ["SKU", "Location", "On Hand"], rows: [["1", "L1", 5], ["1", "L1", 5]] };
    const fc: Table = { columns: ["sku_id", "location_id", "binbalance_qtybal", "exp_date"], rows: [["1", "L1", 10, "2026-07-17"]] };
    const p = buildPreset("MHT", "FC");
    const sa = buildStandard(mht, p.rows, "a", "A").table;
    const sb = buildStandard(fc, p.rows, "b", "B").table;
    const r = compareTables(sa, sb, ["SKU", "Location"], p.compareFields!, { fuzzyKeys: false, tolerance: 0, tagA: "MHT", tagB: "FC" });
    expect(r.summary.match).toBe(1);
  });
});
