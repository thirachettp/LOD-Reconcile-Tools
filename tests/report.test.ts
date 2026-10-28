import { describe, expect, it } from "vitest";
import { compareTables } from "../lib/compare";
import { defaultSideName, makeItem, reportText } from "../lib/report";
import type { Table } from "../lib/types";

const t = (rows: (string | number)[][]): Table => ({ columns: ["IBC", "SDEPT", "Quantity"], rows });
const opts = { fuzzyKeys: false, tolerance: 0, tagA: "A", tagB: "B" };

describe("report", () => {
  it("Match report in the requested format", () => {
    const r = compareTables(t([["1", "d", 5]]), t([["1", "d", 5]]), ["IBC", "SDEPT"], ["Quantity"], opts);
    const txt = reportText([makeItem(r, "WMS Sprint vs InitialStock")], false);
    expect(txt).toBe(
      "ขออนุญาตสรุปการ Reconcile Stock ดังนี้\n\n1. WMS Sprint vs InitialStock\nKeys : IBC, SDEPT\nCompare : Quantity\nStatus : Match\n",
    );
  });
  it("Not Match shows counts and totals; numbering", () => {
    const r = compareTables(t([["1", "d", 5], ["2", "d", 1]]), t([["1", "d", 4]]), ["IBC", "SDEPT"], ["Quantity"], opts);
    const it = makeItem(r, "X vs Y");
    expect(it.status).toContain("Not Match");
    expect(it.totals).toContain("Rows: 2 vs 1 (50.00 %)");
    expect(it.totals).toContain("Quantity: 6 vs 4 (66.67 %)");
    const txt = reportText([it, makeItem(r, "P vs Q")], true);
    expect(txt).toContain("2. P vs Q");
    expect(txt).toContain("   Quantity: 6 vs 4 (66.67 %)");
  });
  it("default side name", () => {
    expect(defaultSideName({ system: "FC", files: ["a.xlsx"], rowCount: 1 })).toBe("FC");
    expect(defaultSideName({ system: "OTHER", files: ["Initialstock.csv"], rowCount: 1 })).toBe("Initialstock");
  });
});

import { sideNames, makeItem as mk2 } from "../lib/report";
describe("sideNames", () => {
  const info = (a: string, b: string) => ({ a: { system: a, files: ["a.csv"], rowCount: 1 }, b: { system: b, files: ["b.csv"], rowCount: 1 } });
  it("uses system names, falls back to A/B when equal or missing", () => {
    expect(sideNames(info("FC", "JDA"))).toEqual(["FC", "JDA"]);
    expect(sideNames(info("FC", "FC"))).toEqual(["A", "B"]);
    expect(sideNames(null)).toEqual(["A", "B"]);
    expect(sideNames(info("WMS Sprint", "อื่น ๆ"))).toEqual(["WMS Sprint", "b"]);
  });
  it("status text carries names", () => {
    const base = { keys: ["k"], fields: [], summary: { total: 5, match: 3, mismatch: 0, missingA: 1, missingB: 1, duplicateKeysA: 0, duplicateKeysB: 0, rowsA: 5, rowsB: 5, keysA: 5, keysB: 5, perField: [] } };
    expect(mk2({ ...base, info: { mappingName: null, a: { system: "FC", files: [], rowCount: 0 }, b: { system: "JDA", files: [], rowCount: 0 }, generatedAt: "", tolerance: 0, fuzzyKeys: false } }, "t").status).toContain("Missing FC 1, Missing JDA 1");
  });
});
