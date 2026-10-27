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
    expect(it.totals).toContain("Rows: 2 vs 1");
    expect(it.totals).toContain("Quantity: 6 vs 4");
    const txt = reportText([it, makeItem(r, "P vs Q")], true);
    expect(txt).toContain("2. P vs Q");
    expect(txt).toContain("   Quantity: 6 vs 4");
  });
  it("default side name", () => {
    expect(defaultSideName({ system: "FC", files: ["a.xlsx"], rowCount: 1 })).toBe("FC");
    expect(defaultSideName({ system: "OTHER", files: ["Initialstock.csv"], rowCount: 1 })).toBe("Initialstock");
  });
});
