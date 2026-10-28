import { describe, expect, it } from "vitest";
import type { SavedMapping } from "../lib/library";
import { handleTemplates, type TemplateStore } from "../lib/server/templates";

const mem = (): TemplateStore => {
  const m = new Map<string, SavedMapping>();
  return { all: async () => [...m.values()], put: async (i) => void m.set(i.id, i), del: async (id) => void m.delete(id) };
};
const PASS = "team-secret";
const rows = [{ id: "r1", target: "SKU", a: { function: "FIRST", columns: ["sku"] }, b: { function: "FIRST", columns: ["ITEM"] } }];
const put = (store: TemplateStore, extra: object = {}, pass: string | null = PASS) =>
  handleTemplates({ method: "PUT", passcode: pass, body: { name: "FC vs X", sysA: "FC", sysB: "OTHER", rows, compareKeys: ["SKU"], ...extra } }, store, PASS);

describe("team templates API", () => {
  it("not configured / no passcode / wrong passcode", async () => {
    expect((await handleTemplates({ method: "GET" }, null, PASS)).status).toBe(503);
    expect((await handleTemplates({ method: "GET" }, mem(), undefined)).status).toBe(503);
    expect((await handleTemplates({ method: "GET", passcode: "bad" }, mem(), PASS)).status).toBe(401);
    expect((await handleTemplates({ method: "GET" }, mem(), PASS)).status).toBe(401);
  });

  it("save, list, update, name clash, overwrite", async () => {
    const s = mem();
    const r1 = await put(s, { author: "Somchai" });
    expect(r1.status).toBe(200);
    const item = (r1.json as { item: SavedMapping }).item;
    expect(item.updatedBy).toBe("Somchai");
    expect(item.id).toMatch(/^t/);

    const list = await handleTemplates({ method: "GET", passcode: PASS }, s, PASS);
    expect((list.json as { items: unknown[] }).items).toHaveLength(1);

    // same name, new item → 409 name_taken
    const clash = await put(s);
    expect(clash.status).toBe(409);
    expect((clash.json as { error: string }).error).toBe("name_taken");
    // overwrite
    const ow = await put(s, { overwrite: true, compareKeys: ["SKU", "Location"] });
    expect(ow.status).toBe(200);
    expect(((ow.json as { item: SavedMapping }).item).id).toBe(item.id);

    // update with stale expectedUpdatedAt → conflict
    const stale = await put(s, { id: item.id, expectedUpdatedAt: item.updatedAt });
    expect(stale.status).toBe(409);
    expect((stale.json as { error: string }).error).toBe("conflict");
    // update with the current one → ok
    const cur = ((await handleTemplates({ method: "GET", passcode: PASS }, s, PASS)).json as { items: SavedMapping[] }).items[0];
    const ok = await put(s, { id: item.id, expectedUpdatedAt: cur.updatedAt, name: "Renamed via put" });
    expect(ok.status).toBe(200);
  });

  it("rename, delete, deleted item", async () => {
    const s = mem();
    const a = ((await put(s)).json as { item: SavedMapping }).item;
    await put(s, { name: "Other" });
    const bad = await handleTemplates({ method: "PATCH", passcode: PASS, body: { id: a.id, name: "other" } }, s, PASS);
    expect(bad.status).toBe(409);
    const ok = await handleTemplates({ method: "PATCH", passcode: PASS, body: { id: a.id, name: "New name" } }, s, PASS);
    expect(ok.status).toBe(200);
    await handleTemplates({ method: "DELETE", passcode: PASS, id: a.id }, s, PASS);
    const gone = await put(s, { id: a.id, name: "Whatever" });
    expect(gone.status).toBe(404);
  });

  it("validates input", async () => {
    const s = mem();
    expect((await put(s, { name: "  " })).status).toBe(400);
    expect((await put(s, { name: "FC vs Initialstock" })).status).toBe(400); // builtin name
    expect((await put(s, { rows: [] })).status).toBe(400);
    expect((await put(s, { rows: [{ target: "x", a: { function: "EVAL", columns: [] }, b: { function: "FIRST", columns: [] } }] })).status).toBe(400);
    expect((await put(s, { name: "x".repeat(81) })).status).toBe(400);
  });
});
