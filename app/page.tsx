"use client";
import type { ReportItem } from "@/lib/report";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompareStep, type CompareSel } from "@/components/CompareStep";
import { MappingStep, type BuildInfo, type LibraryApi, type SaveResult } from "@/components/MappingStep";
import { UploadStep } from "@/components/UploadStep";
import { Stepper } from "@/components/ui";
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
import { useSide, type SideApi } from "@/lib/useSide";
import { SYSTEMS, SYSTEM_LABELS, type MappingRow, type SideInfo, type SystemCode } from "@/lib/types";

const storeKey = (a: SystemCode, b: SystemCode) => `lod-reconcile:mapping:${a}|${b}`;

function loadPairSaved(a: SystemCode, b: SystemCode): MappingRow[] | null {
  try {
    const raw = localStorage.getItem(storeKey(a, b));
    if (!raw) return null;
    const rows = JSON.parse(raw) as MappingRow[];
    return Array.isArray(rows) && rows.length ? rows : null;
  } catch {
    return null;
  }
}

const shortTag = (name: string, fallback: string) => {
  const base = name.split(" +")[0].replace(/\.[^.]+$/, "").replace(/[^0-9A-Za-zก-๙]/g, "");
  return base.slice(0, 5) || fallback;
};

const isSystem = (x: unknown): x is SystemCode => typeof x === "string" && (SYSTEMS as string[]).includes(x);

function sideInfo(api: SideApi): SideInfo {
  return {
    system: SYSTEM_LABELS[api.system],
    files: api.files.map((f) =>
      f.info.isExcel && f.info.sheets.length > 1 ? `${f.info.name} [${f.selected.join(", ")}]` : f.info.name,
    ),
    rowCount: api.table?.rowCount ?? 0,
  };
}

export default function Page() {
  const [step, setStep] = useState(1);
  const [stdBuild, setStdBuild] = useState<BuildInfo | null>(null);
  const [compareMeta, setCompareMeta] = useState<CompareMeta | null>(null);
  const [report, setReport] = useState<ReportItem[]>([]);

  const invalidate = useCallback(() => {
    setStdBuild(null);
    setCompareMeta(null);
  }, []);

  const a = useSide("a", "FC", invalidate);
  const b = useSide("b", "JDA", invalidate);

  const colsA = useMemo(() => a.table?.columns ?? [], [a.table]);
  const colsB = useMemo(() => b.table?.columns ?? [], [b.table]);
  const colsKey = colsA.join("\u0001") + "||" + colsB.join("\u0001");

  // ── Mapping: สูตรตั้งต้นตามคู่ระบบ / Mapping ที่ตั้งชื่อไว้ ──
  const preset = useMemo(() => buildPreset(a.system, b.system, colsA, colsB), [a.system, b.system, colsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<MappingRow[]>(() => buildPreset("FC", "JDA").rows);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<SavedMapping[]>([]);
  const [current, setCurrent] = useState<{ id: string; name: string; builtin?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cmp, setCmp] = useState<CompareSel>({});
  const [cmpVersion, setCmpVersion] = useState(0);
  const skipPairReset = useRef(false);

  useEffect(() => setSaved(listSaved()), []); // อ่านหลัง mount (กัน SSR ไม่ตรง)

  useEffect(() => {
    if (touched) return;
    const pair = loadPairSaved(a.system, b.system);
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
      localStorage.setItem(storeKey(a.system, b.system), JSON.stringify(r));
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
      localStorage.removeItem(storeKey(a.system, b.system));
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

  const lib: LibraryApi = {
    saved,
    builtins: BUILTIN_MAPPINGS,
    current,
    dirty,
    onLoad: (id) => {
      if (!id) return resetPreset();
      const m = [...BUILTIN_MAPPINGS, ...saved].find((x) => x.id === id);
      if (m) applyMapping(m, { id: m.id, name: m.name, builtin: m.builtin });
    },
    onSave: (name, { asNew, overwrite }): SaveResult => {
      try {
        const item = saveMapping({
          id: !asNew && current && !current.builtin ? current.id : undefined,
          name,
          sysA: a.system,
          sysB: b.system,
          rows,
          compareKeys: cmp.keys,
          compareFields: cmp.fields,
          overwrite,
        });
        setSaved(listSaved());
        setCurrent({ id: item.id, name: item.name });
        setDirty(false);
        return { ok: true };
      } catch (e) {
        return { ok: false, taken: e instanceof NameTakenError, error: errText(e) };
      }
    },
    onRename: (name): SaveResult => {
      if (!current || current.builtin) return { ok: false, error: "เปลี่ยนชื่อได้เฉพาะ Mapping ที่บันทึกไว้เอง" };
      try {
        const item = renameMapping(current.id, name);
        setSaved(listSaved());
        setCurrent({ id: item.id, name: item.name });
        return { ok: true };
      } catch (e) {
        return { ok: false, taken: e instanceof NameTakenError, error: errText(e) };
      }
    },
    onDelete: () => {
      if (!current || current.builtin) return;
      try {
        deleteMapping(current.id);
      } catch {
        /* noop */
      }
      setSaved(listSaved());
      resetPreset();
    },
  };

  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const runBuild = async () => {
    setBuilding(true);
    setBuildError(null);
    try {
      const r = await call("build", { rows, labelA: a.displayName, labelB: b.displayName });
      setStdBuild(r);
      setCompareMeta(null);
      if (r.a.columns.length && r.warnings.length === 0) setStep(3);
    } catch (e) {
      setBuildError(errText(e));
    } finally {
      setBuilding(false);
    }
  };

  const swap = () => {
    const sa = a.snapshot();
    const sb = b.snapshot();
    a.restore(sb);
    b.restore(sa);
    setTouched(false);
    invalidate();
  };

  const resetAll = () => {
    a.reset();
    b.reset();
    setTouched(false);
    setCurrent(null);
    setDirty(false);
    setCmp({});
    invalidate();
    setStep(1);
  };

  const ready = !!(a.table && b.table);

  // ชื่อคอลัมน์ผลลัพธ์: ใช้รหัสระบบ (Qty_MHT / Qty_FC) ถ้าสองฝั่งต่างระบบ; ไม่งั้นใช้ชื่อไฟล์ ถ้ายังซ้ำใช้ A / B
  const sysTag = (sys: SystemCode, name: string, fb: string) => (sys === "OTHER" ? shortTag(name, fb) : sys);
  let tagA = sysTag(a.system, a.displayName, "A");
  let tagB = sysTag(b.system, b.displayName, "B");
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
    <div className="container">
      <div className="header">
        <div>
          <div className="title">📦 LOD · Reconcile Tools</div>
          <div className="subtitle">เทียบข้อมูลสต็อกระหว่างระบบ FC · JDA · MHT</div>
        </div>
        <span className="privacy" title="ไฟล์ถูกประมวลผลในเบราว์เซอร์ ไม่ถูกอัปโหลดไปเซิร์ฟเวอร์">
          🔒 ประมวลผลในเครื่องคุณ — ข้อมูลไม่ถูกส่งออก
        </span>
      </div>

      <Stepper step={step} onStep={setStep} done={[ready, !!stdBuild, !!compareMeta]} enabled={[true, ready, !!stdBuild]} />

      {step === 1 && <UploadStep a={a} b={b} onSwap={swap} onReset={resetAll} onNext={() => setStep(2)} />}

      {step === 2 && (
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
            onBack={() => setStep(1)}
          />
          {stdBuild && (
            <div className="row" style={{ marginTop: 14 }}>
              <span className="spacer" />
              <button className="btn primary" onClick={() => setStep(3)}>
                ไปหน้า Compare →
              </button>
            </div>
          )}
        </>
      )}

      {step === 3 && stdBuild && (
        <CompareStep
          stdColsA={stdBuild.a.columns}
          stdColsB={stdBuild.b.columns}
          defaultFields={preset.compareFields}
          tagA={tagA}
          tagB={tagB}
          meta={compareMeta}
          onMeta={setCompareMeta}
          onBack={() => setStep(2)}
          runInfo={{ mappingName, a: sideInfo(a), b: sideInfo(b) }}
          sel={cmp}
          selVersion={cmpVersion}
          report={report}
          onReport={setReport}
          onSel={(s) => {
            setCmp(s);
            if (current) setDirty(true);
          }}
        />
      )}

      <div className="footer">LOD · Reconcile Tools · FC / JDA / MHT · Next.js · ประมวลผลบนเบราว์เซอร์</div>
    </div>
  );
}
