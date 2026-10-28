"use client";
import Link from "next/link";
import { useState } from "react";
import { PairWorkspace, type PairStatus } from "@/components/PairWorkspace";
import { UploadStep } from "@/components/UploadStep";
import { Stepper } from "@/components/ui";
import type { ReportItem } from "@/lib/report";
import { useSide } from "@/lib/useSide";

export default function Page() {
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<PairStatus>({ built: false, meta: null });
  const [report, setReport] = useState<ReportItem[]>([]);
  const [resetSignal, setResetSignal] = useState(0);

  const a = useSide("a", "FC", () => {});
  const b = useSide("b", "JDA", () => {});

  const swap = () => {
    const sa = a.snapshot();
    const sb = b.snapshot();
    a.restore(sb);
    b.restore(sa);
    setResetSignal((n) => n + 1);
  };

  const resetAll = () => {
    a.reset();
    b.reset();
    setResetSignal((n) => n + 1);
    setStep(1);
  };

  const ready = !!(a.table && b.table);

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="title">📦 LOD · Reconcile Tools</div>
          <div className="subtitle">เทียบข้อมูลสต็อกระหว่างระบบ FC · JDA · MHT</div>
        </div>
        <div className="row">
          <Link className="btn small" href="/multi" title="เทียบหลายชุดข้อมูลพร้อมกัน เช่น A=B และ B=C">
            🔀 เทียบหลายชุด (3 ชุด / หลายคู่)
          </Link>
          <span className="privacy" title="ไฟล์ถูกประมวลผลในเบราว์เซอร์ ไม่ถูกอัปโหลดไปเซิร์ฟเวอร์">
            🔒 ประมวลผลในเครื่องคุณ — ข้อมูลไม่ถูกส่งออก
          </span>
        </div>
      </div>

      <Stepper step={step} onStep={setStep} done={[ready, status.built, !!status.meta]} enabled={[true, ready, status.built]} />

      {step === 1 && <UploadStep a={a} b={b} onSwap={swap} onReset={resetAll} onNext={() => setStep(2)} />}

      {/* PairWorkspace อยู่ตลอด (ไม่ unmount) เพื่อเก็บ Mapping/ผลไว้เมื่อกลับไปหน้า Upload */}
      <div style={{ display: step === 1 ? "none" : undefined }}>
        <PairWorkspace
          a={a}
          b={b}
          view={step === 3 ? "compare" : "mapping"}
          onView={(v) => setStep(v === "compare" ? 3 : 2)}
          onBackToUpload={() => setStep(1)}
          report={report}
          onReport={setReport}
          resetSignal={resetSignal}
          onStatus={setStatus}
        />
      </div>

      <div className="footer">LOD · Reconcile Tools · FC / JDA / MHT · Next.js · ประมวลผลบนเบราว์เซอร์</div>
    </div>
  );
}
