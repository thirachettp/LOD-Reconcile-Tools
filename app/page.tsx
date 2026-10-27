"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CompareStep } from "@/components/CompareStep";
import { MappingStep, type BuildInfo } from "@/components/MappingStep";
import { UploadStep } from "@/components/UploadStep";
import { Stepper } from "@/components/ui";
import { call, download } from "@/lib/engine-client";
import type { CompareMeta } from "@/lib/engine.worker";
import { exportMapping, importMapping } from "@/lib/mapping-io";
import { buildPreset, fitRowsToColumns } from "@/lib/presets";
import { useSide } from "@/lib/useSide";
import type { MappingRow, SystemCode } from "@/lib/types";

const storeKey = (a: SystemCode, b: SystemCode) => `lod-reconcile:mapping:${a}|${b}`;

function loadSaved(a: SystemCode, b: SystemCode): MappingRow[] | null {
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

export default function Page() {
  const [step, setStep] = useState(1);
  const [stdBuild, setStdBuild] = useState<BuildInfo | null>(null);
  const [compareMeta, setCompareMeta] = useState<CompareMeta | null>(null);

  const invalidate = useCallback(() => {
    setStdBuild(null);
    setCompareMeta(null);
  }, []);

  const a = useSide("a", "FC", invalidate);
  const b = useSide("b", "JDA", invalidate);

  const colsA = useMemo(() => a.table?.columns ?? [], [a.table]);
  const colsB = useMemo(() => b.table?.columns ?? [], [b.table]);
  const colsKey = colsA.join("\u0001") + "||" + colsB.join("\u0001");

  // ── Mapping: สูตรตั้งต้นตามคู่ระบบ (หรือที่เคยแก้ไว้ของคู่นี้) ──
  const preset = useMemo(() => buildPreset(a.system, b.system, colsA, colsB), [a.system, b.system, colsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<MappingRow[]>(() => buildPreset("FC", "JDA").rows);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched) return;
    const saved = loadSaved(a.system, b.system);
    setRows(fitRowsToColumns(saved ?? preset.rows, colsA, colsB));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, touched]);

  // เปลี่ยนคู่ระบบ → กลับไปใช้สูตรของคู่ใหม่
  useEffect(() => {
    setTouched(false);
  }, [a.system, b.system]);

  const editRows = (r: MappingRow[]) => {
    setRows(r);
    setTouched(true);
    invalidate();
    try {
      localStorage.setItem(storeKey(a.system, b.system), JSON.stringify(r));
    } catch {
      /* ไม่เป็นไร ถ้า storage ใช้ไม่ได้ */
    }
  };

  const resetPreset = () => {
    try {
      localStorage.removeItem(storeKey(a.system, b.system));
    } catch {
      /* noop */
    }
    setTouched(false);
    setRows(fitRowsToColumns(preset.rows, colsA, colsB));
    invalidate();
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
      setBuildError(e instanceof Error ? e.message : String(e));
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
    invalidate();
    setStep(1);
  };

  const ready = !!(a.table && b.table);
  // ถ้ามี warning ตอน Build ค้างอยู่หน้า Mapping ให้ผู้ใช้ตรวจก่อน แล้วกดไปต่อเอง
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

      <Stepper
        step={step}
        onStep={setStep}
        done={[ready, !!stdBuild, !!compareMeta]}
        enabled={[true, ready, !!stdBuild]}
      />

      {step === 1 && <UploadStep a={a} b={b} onSwap={swap} onReset={resetAll} onNext={() => setStep(2)} />}

      {step === 2 && (
        <>
          <MappingStep
            rows={rows}
            onRows={editRows}
            sysA={a.system}
            sysB={b.system}
            colsA={colsA}
            colsB={colsB}
            nameA={a.displayName}
            nameB={b.displayName}
            preset={preset}
            touched={touched}
            onResetPreset={resetPreset}
            onImport={(text) => {
              try {
                editRows(importMapping(text).rows);
              } catch (e) {
                setBuildError(`นำเข้า Mapping ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
            onExport={() => download(exportMapping(a.system, b.system, rows), `Mapping_${a.system}_${b.system}.json`, "application/json")}
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
        />
      )}

      <div className="footer">LOD · Reconcile Tools · FC / JDA / MHT · Next.js · ประมวลผลบนเบราว์เซอร์</div>
    </div>
  );
}
