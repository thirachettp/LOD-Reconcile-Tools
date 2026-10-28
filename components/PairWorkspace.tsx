"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompareStep, type CompareSel } from "./CompareStep";
import { MappingStep, type BuildInfo, type LibraryApi, type LibraryCurrent, type SaveResult } from "./MappingStep";
import { call, download } from "@/lib/engine-client";
import type { CompareMeta } from "@/lib/engine.worker";
import {
  BUILTIN_MAPPINGS,
  NameTakenError,
  cloneRows,
  deleteMapping,
  listSaved,
  renameMapping,
  saveMapping,
  type SavedMapping,
} from "@/lib/library";
import { exportMapping, importMapping } from "@/lib/mapping-io";
import { buildPreset, fitRowsToColumns } from "@/lib/presets";
import type { ReportItem } from "@/lib/report";
import { getAuthor, lockTeam, refreshTeam, setAuthor, teamDelete, teamRename, teamSave, unlockTeam, useTeam } from "@/lib/team-client";
import type { SideApi } from "@/lib/useSide";
import { SYSTEMS, SYSTEM_LABELS, type MappingRow, type SideInfo, type SystemCode } from "@/lib/types";

const storeKey = (a: SystemCode, b: SystemCode, scope?: string) => (scope ? `lod-reconcile:multi:${scope}:${a}|${b}` : `lod-reconcile:mapping:${a}|${b}`);

function loadPairSaved(a: SystemCode, b: SystemCode, scope?: string): MappingRow[] | null {
  try {
    const raw = localStorage.getItem(storeKey(a, b, scope));
    if (!raw) return null;
    const rows = JSON.parse(raw) as MappingRow[];
    return Array.isArray(rows) && rows.length ? rows : null;
  } catch {
    return null;
  }
}

const shortTag = (name: string, fallback: string, max = 5) => {
  const base = name.split(" +")[0].replace(/\.[^.]+$/, "").replace(/[^0-9A-Za-zก-๙]/g, "");
  return base.slice(0, max) || fallback;
};

const isSystem = (x: unknown): x is SystemCode => typeof x === "string" && (SYSTEMS as string[]).includes(x);

export function sideInfo(api: SideApi): SideInfo {
  return {
    system: api.sysName || SYSTEM_LABELS[api.system],
    files: api.files.map((f) =>
      f.info.isExcel && f.info.sheets.length > 1 ? `${f.info.name} [${f.selected.join(", ")}]` : f.info.name,
    ),
    rowCount: api.table?.rowCount ?? 0,
  };
}

export type PairView = "mapping" | "compare";

export interface PairStatus {
  built: boolean;
  meta: CompareMeta | null;
}

/**
 * พื้นที่ทำงานของ "หนึ่งคู่" (A vs B): ตั้ง Mapping → Build Standard Table → Compare
 * ใช้ทั้งหน้าเดิม (คู่ main) และหน้าเทียบหลายชุด (คู่ละหนึ่ง workspace, Mapping/Key/Fields แยกกัน)
 */
export function PairWorkspace({
  a,
  b,
  pairId,
  view,
  onView,
  onBackToUpload,
  report,
  onReport,
  hideReport,
  resetSignal,
  onStatus,
}: {
  a: SideApi;
  b: SideApi;
  /** ไม่ระบุ = คู่เดียวของหน้าเดิม */
  pairId?: string;
  view: PairView;
  onView: (v: PairView) => void;
  onBackToUpload: () => void;
  report: ReportItem[];
  onReport: (r: ReportItem[]) => void;
  hideReport?: boolean;
  /** เพิ่มค่าเพื่อสั่งล้าง Mapping/ผลลัพธ์ (เช่น หลังสลับหรือ Reset) */
  resetSignal?: number;
  onStatus?: (s: PairStatus) => void;
}) {
  const scope = pairId ? `${pairId}:${a.side}>${b.side}` : undefined;
  const [stdBuild, setStdBuild] = useState<BuildInfo | null>(null);
  const [compareMeta, setCompareMeta] = useState<CompareMeta | null>(null);

  const invalidate = useCallback(() => {
    setStdBuild(null);
    setCompareMeta(null);
  }, []);

  // ข้อมูลของชุดใดชุดหนึ่งเปลี่ยน (อัปโหลด/รวมใหม่) → Standard Table และผลเดิมใช้ไม่ได้แล้ว
  useEffect(() => {
    invalidate();
  }, [a.table, b.table, invalidate]);

  useEffect(() => {
    onStatus?.({ built: !!stdBuild, meta: compareMeta });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdBuild, compareMeta]);

  const colsA = useMemo(() => a.table?.columns ?? [], [a.table]);
  const colsB = useMemo(() => b.table?.columns ?? [], [b.table]);
  const colsKey = colsA.join("\u0001") + "||" + colsB.join("\u0001");

  // ── Mapping: สูตรตั้งต้นตามคู่ระบบ / Mapping ที่ตั้งชื่อไว้ ──
  const preset = useMemo(() => buildPreset(a.system, b.system, colsA, colsB), [a.system, b.system, colsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<MappingRow[]>(() => buildPreset("FC", "JDA").rows);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<SavedMapping[]>([]);
  const [current, setCurrent] = useState<LibraryCurrent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cmp, setCmp] = useState<CompareSel>({});
  const [cmpVersion, setCmpVersion] = useState(0);
  const skipPairReset = useRef(false);

  useEffect(() => setSaved(listSaved()), []); // อ่านหลัง mount (กัน SSR ไม่ตรง)

  useEffect(() => {
    if (touched) return;
    const pair = loadPairSaved(a.system, b.system, scope);
    setRows(fitRowsToColumns(pair ?? preset.rows, colsA, colsB));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, touched]);

  // เปลี่ยนคู่ระบบเอง → กลับไปใช้สูตรของคู่ใหม่ (ยกเว้นเปลี่ยนเพราะโหลด Mapping)
  useEffect(() => {
    if (skipPairReset.current) {
      skipPairReset.current = false;
      return;
    }
    setTouched(false);
    setCurrent(null);
    setDirty(false);
    setCmp({});
  }, [a.system, b.system]);

  // ไฟล์เปลี่ยน → จับคู่ชื่อคอลัมน์ในสูตรกับหัวตารางจริง (ไม่สนช่องว่าง/ตัวพิมพ์)
  useEffect(() => {
    if (touched) setRows((r) => fitRowsToColumns(r, colsA, colsB));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colsKey]);

  const editRows = (r: MappingRow[]) => {
    setRows(r);
    setTouched(true);
    if (current) setDirty(true);
    invalidate();
    try {
      localStorage.setItem(storeKey(a.system, b.system, scope), JSON.stringify(r));
    } catch {
      /* ไม่เป็นไร ถ้า storage ใช้ไม่ได้ */
    }
  };

  /** ใส่ Mapping ลงตัวแก้ไข (และสลับระบบ A/B ให้ตรงกับ Mapping) */
  const applyMapping = (m: Pick<SavedMapping, "rows" | "sysA" | "sysB" | "compareKeys" | "compareFields">, cur: typeof current) => {
    const needA = m.sysA !== a.system;
    const needB = m.sysB !== b.system;
    if (needA || needB) skipPairReset.current = true;
    setRows(fitRowsToColumns(cloneRows(m.rows), colsA, colsB));
    setTouched(true);
    setCurrent(cur);
    setDirty(false);
    setCmp({ keys: m.compareKeys, fields: m.compareFields });
    setCmpVersion((v) => v + 1);
    if (needA) a.setSystem(m.sysA);
    if (needB) b.setSystem(m.sysB);
    invalidate();
  };

  const resetPreset = () => {
    try {
      localStorage.removeItem(storeKey(a.system, b.system, scope));
    } catch {
      /* noop */
    }
    setTouched(false);
    setCurrent(null);
    setDirty(false);
    setCmp({});
    setCmpVersion((v) => v + 1);
    setRows(fitRowsToColumns(preset.rows, colsA, colsB));
    invalidate();
  };

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const team = useTeam();
  const lib: LibraryApi = {
    saved,
    team: team.items,
    teamStatus: { state: team.state, message: team.message },
    builtins: BUILTIN_MAPPINGS,
    current,
    dirty,
    onLoad: (id) => {
      if (!id) return resetPreset();
      const b = BUILTIN_MAPPINGS.find((x) => x.id === id);
      const t = team.items.find((x) => x.id === id);
      const l = saved.find((x) => x.id === id);
      const m = b ?? t ?? l;
      if (m) applyMapping(m, { id: m.id, name: m.name, builtin: m.builtin, scope: t ? "team" : l ? "local" : undefined, updatedAt: m.updatedAt });
    },
    onSave: async (name, { asNew, overwrite, scope }): Promise<SaveResult> => {
      const keepCurrent = !asNew && !!current && !current.builtin;
      const target = keepCurrent ? current!.scope ?? "local" : scope ?? "local";
      if (target === "team") {
        const r = await teamSave({
          id: keepCurrent ? current!.id : undefined,
          name,
          sysA: a.system,
          sysB: b.system,
          rows,
          compareKeys: cmp.keys,
          compareFields: cmp.fields,
          overwrite,
          expectedUpdatedAt: keepCurrent ? current!.updatedAt : undefined,
        });
        if (!r.ok) return { ok: false, taken: r.taken, error: r.error };
        setCurrent({ id: r.item.id, name: r.item.name, scope: "team", updatedAt: r.item.updatedAt });
        setDirty(false);
        return { ok: true };
      }
      try {
        const item = saveMapping({
          id: keepCurrent ? current!.id : undefined,
          name,
          sysA: a.system,
          sysB: b.system,
          rows,
          compareKeys: cmp.keys,
          compareFields: cmp.fields,
          overwrite,
        });
        setSaved(listSaved());
        setCurrent({ id: item.id, name: item.name, scope: "local", updatedAt: item.updatedAt });
        setDirty(false);
        return { ok: true };
      } catch (e) {
        return { ok: false, taken: e instanceof NameTakenError, error: errText(e) };
      }
    },
    onRename: async (name): Promise<SaveResult> => {
      if (!current || current.builtin) return { ok: false, error: "เปลี่ยนชื่อได้เฉพาะ Template ที่บันทึกไว้เอง" };
      if (current.scope === "team") {
        const r = await teamRename(current.id, name, current.updatedAt);
        if (!r.ok) return { ok: false, taken: r.taken, error: r.error };
        setCurrent({ id: r.item.id, name: r.item.name, scope: "team", updatedAt: r.item.updatedAt });
        return { ok: true };
      }
      try {
        const item = renameMapping(current.id, name);
        setSaved(listSaved());
        setCurrent({ id: item.id, name: item.name, scope: "local", updatedAt: item.updatedAt });
        return { ok: true };
      } catch (e) {
        return { ok: false, taken: e instanceof NameTakenError, error: errText(e) };
      }
    },
    onDelete: async () => {
      if (!current || current.builtin) return null;
      if (current.scope === "team") {
        const msg = await teamDelete(current.id);
        if (msg) return msg;
      } else {
        try {
          deleteMapping(current.id);
        } catch {
          /* noop */
        }
        setSaved(listSaved());
      }
      resetPreset();
      return null;
    },
    teamActions: { unlock: unlockTeam, lock: lockTeam, refresh: () => void refreshTeam(), getAuthor, setAuthor },
  };

  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const runBuild = async () => {
    setBuilding(true);
    setBuildError(null);
    try {
      const r = await call("build", { rows, labelA: a.displayName, labelB: b.displayName, pairId: pairId ?? "main", dsA: a.side, dsB: b.side });
      setStdBuild(r);
      setCompareMeta(null);
      if (r.a.columns.length && r.warnings.length === 0) onView("compare");
    } catch (e) {
      setBuildError(errText(e));
    } finally {
      setBuilding(false);
    }
  };


  // สั่งล้างจากภายนอก (สลับ A↔B / Reset ทั้งหมด)
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    setTouched(false);
    setCurrent(null);
    setDirty(false);
    setCmp({});
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  // ชื่อคอลัมน์ผลลัพธ์: ใช้รหัสระบบ (Qty_MHT / Qty_FC) ถ้าสองฝั่งต่างระบบ; ไม่งั้นใช้ชื่อไฟล์ ถ้ายังซ้ำใช้ A / B
  const sysTag = (api: SideApi, fb: string) => (api.system === "OTHER" ? (api.sysName ? shortTag(api.sysName, fb, 12) : shortTag(api.displayName, fb)) : api.system);
  let tagA = sysTag(a, "A");
  let tagB = sysTag(b, "B");
  if (tagA === tagB) {
    tagA = shortTag(a.displayName, "A");
    tagB = shortTag(b.displayName, "B");
  }
  if (tagA === tagB) {
    tagA = "A";
    tagB = "B";
  }

  const mappingName = current
    ? current.name + (dirty ? " (แก้ไขแล้ว)" : "")
    : touched
      ? "กำหนดเอง"
      : `สูตรตั้งต้น ${SYSTEM_LABELS[a.system]} ↔ ${SYSTEM_LABELS[b.system]}`;


  return (
    <>
      {view === "mapping" && (
        <>
          <MappingStep
            rows={rows}
            onRows={editRows}
            sysA={a.system}
            sysB={b.system}
            tableA={a.table}
            tableB={b.table}
            nameA={a.displayName}
            nameB={b.displayName}
            preset={preset}
            touched={touched}
            lib={lib}
            onImport={(text) => {
              try {
                const imp = importMapping(text);
                applyMapping(
                  {
                    rows: imp.rows,
                    sysA: isSystem(imp.sysA) ? imp.sysA : a.system,
                    sysB: isSystem(imp.sysB) ? imp.sysB : b.system,
                    compareKeys: imp.keys,
                    compareFields: imp.fields,
                  },
                  null,
                );
                setDirty(false);
                setBuildError(null);
              } catch (e) {
                setBuildError(`นำเข้า Mapping ไม่สำเร็จ: ${errText(e)}`);
              }
            }}
            onExport={() =>
              download(
                exportMapping(a.system, b.system, rows, { name: current?.name, keys: cmp.keys, fields: cmp.fields }),
                `Mapping_${(current?.name ?? `${a.system}_${b.system}`).replace(/[^0-9A-Za-zก-๙_-]+/g, "_")}.json`,
                "application/json",
              )
            }
            build={stdBuild}
            building={building}
            error={buildError}
            onBuild={runBuild}
            onBack={onBackToUpload}
            pairId={pairId ?? "main"}
            dsA={a.side}
            dsB={b.side}
          />
          {stdBuild && (
            <div className="row" style={{ marginTop: 14 }}>
              <span className="spacer" />
              <button className="btn primary" onClick={() => onView("compare")}>
                ไปหน้า Compare →
              </button>
            </div>
          )}
        </>
      )}

      {view === "compare" && stdBuild && (
        <CompareStep
          stdColsA={stdBuild.a.columns}
          stdColsB={stdBuild.b.columns}
          defaultFields={preset.compareFields}
          tagA={tagA}
          tagB={tagB}
          meta={compareMeta}
          onMeta={setCompareMeta}
          onBack={() => onView("mapping")}
          runInfo={{ mappingName, a: sideInfo(a), b: sideInfo(b) }}
          sel={cmp}
          selVersion={cmpVersion}
          report={report}
          onReport={onReport}
          hideReport={hideReport}
          pairId={pairId ?? "main"}
          onSel={(s) => {
            setCmp(s);
            if (current) setDirty(true);
          }}
        />
      )}
    </>
  );
}
