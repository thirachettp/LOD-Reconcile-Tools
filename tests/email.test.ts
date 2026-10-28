import { describe, expect, it } from "vitest";
import { buildExecHtml, type ExecPair } from "../lib/email-html";

const pair = (over: Partial<ExecPair["summary"]> = {}, title = "A <b> vs B"): ExecPair => ({
  title,
  nameA: "WMS Sprint",
  nameB: "JDA",
  sideA: "FC · a.xlsx",
  sideB: "JDA · b.csv",
  keys: ["IBC"],
  fields: ["Qty"],
  summary: {
    total: 10, match: 10, mismatch: 0, missingA: 0, missingB: 0, duplicateKeysA: 0, duplicateKeysB: 0,
    rowsA: 10, rowsB: 10, keysA: 10, keysB: 10,
    perField: [{ name: "Qty", isDate: false, kind: "number", totalAbsDiff: 0, rowsDiff: 0, sumA: 100, sumB: 100 }],
    ...over,
  },
});

describe("buildExecHtml", () => {
  it("escapes titles and shows Match", () => {
    const h = buildExecHtml([pair()], { date: "x" });
    expect(h).toContain("A &lt;b&gt; vs B");
    expect(h).not.toContain("<b> vs");
    expect(h).toContain("Match");
    expect(h).toContain("100.00%");
  });
  it("flags Not Match and overall rate", () => {
    const h = buildExecHtml([pair(), pair({ match: 8, mismatch: 2 })], { date: "x" });
    expect(h).toContain("Not Match");
    expect(h).toContain("90.00%");
  });
  it("uses selected system names instead of A/B", () => {
    const h = buildExecHtml([pair({ missingA: 1, match: 9 })], { date: "x" });
    expect(h).toContain("WMS Sprint รวม");
    expect(h).toContain("Missing WMS Sprint");
    expect(h).toContain("JDA ÷ WMS Sprint");
    expect(h).not.toContain("Missing A");
  });
  it("handles empty and zero totals without NaN", () => {
    expect(buildExecHtml([], { date: "x" })).not.toContain("NaN");
    expect(buildExecHtml([pair({ total: 0, match: 0 })], { date: "x" })).not.toContain("NaN");
  });
});
