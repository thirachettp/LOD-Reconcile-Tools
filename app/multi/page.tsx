"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PairWorkspace, type PairStatus, type PairView } from "@/components/PairWorkspace";
import { UploadCard } from "@/components/UploadStep";
import { Alert } from "@/components/ui";
import { call, download } from "@/lib/engine-client";
import { defaultSideName, makeItem, reportText } from "@/lib/report";
import { useSide, type SideApi } from "@/lib/useSide";

interface PairCfg {
  id: string;
  a: number;
  b: number;
}

const noop = () => {};
const MAX_DS = 4;
const MAX_PAIRS = 6;
let pairSeq = 2;

const ready = (s: SideApi) => !!s.table;

export default function MultiPage() {
  // ชุดข้อมูล (ใช้ Hook คงที่ 4 ชุด แสดงตามจำนวนที่ผู้ใช้เปิด — ตั้งต้น 3 ชุด)
  const d1 = useSide("d1", "OTHER", noop, "ชุด 1");
  const d2 = useSide("d2", "OTHER", noop, "ชุด 2");
  const d3 = useSide("d3", "OTHER", noop, "ชุด 3");
  const d4 = useSide("d4", "OTHER", noop, "ชุด 4");
  const all = [d1, d2, d3, d4];
  const [count, setCount] = useState(3);
  const sides = all.slice(0, count);

  const [pairs, setPairs] = useState<PairCfg[]>([
    { id: "p1", a: 0, b: 1 },
    { id: "p2", a: 1, b: 2 },
  ]);
  const [active, setActive] = useState("p1");
  const [views, setViews] = useState<Record<string, PairView>>({});
  const [status, setStatus] = useState<Record<string, PairStatus>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [totals, setTotals] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const usablePairs = pairs.filter((p) => p.a < count && p.b < count);
  const activePair = usablePairs.find((p) => p.id === active) ?? usablePairs[0];

  const nameOf = (i: number) => `${all[i].label}: ${all[i].files.length ? all[i].displayName : "ยังไม่มีไฟล์"}`;
  const autoTitle = (p: PairCfg) => `${defaultSideName(infoOf(all[p.a]))} vs ${defaultSideName(infoOf(all[p.b]))}`;
  const titleOf = (p: PairCfg) => (titles[p.id] ?? "").trim() || autoTitle(p);

  const results = usablePairs.filter((p) => status[p.id]?.meta);
  const items = useMemo(
    () => results.map((p) => makeItem(status[p.id]!.meta!, titleOf(p))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, titles, pairs, count, d1.files, d2.files, d3.files, d4.files, d1.system, d2.system, d3.system, d4.system],
  );
  const text = reportText(items, totals);

  const setPair = (id: string, patch: Partial<PairCfg>) => setPairs((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* เลือกข้อความในกล่องแล้วคัดลอกเองได้ */
    }
  };

  const exportAll = async () => {
    setExporting(true);
    setExportErr(null);
    try {
      const buf = await call("exportMulti", { pairs: results.map((p) => ({ id: p.id, title: titleOf(p) })) });
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      download(buf, `CompareStock_MultiPair_${p2(d.getDate())}${p2(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}_${p2(d.getHours())}${p2(d.getMinutes())}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="title">🔀 LOD · เทียบหลายชุดข้อมูล</div>
          <div className="subtitle">อัปโหลดครั้งเดียว แล้วเทียบหลายคู่ เช่น A = B และ B = C — แต่ละคู่มี Mapping / Key / Compare Fields ของตัวเอง</div>
        </div>
        <div className="row">
          <Link className="btn small" href="/">
            ← โหมดเทียบ 2 ชุด
          </Link>
          <span className="privacy" title="ไฟล์ถูกประมวลผลในเบราว์เซอร์ ไม่ถูกอัปโหลดไปเซิร์ฟเวอร์">
            🔒 ประมวลผลในเครื่องคุณ — ข้อมูลไม่ถูกส่งออก
          </span>
        </div>
      </div>

      <div className="sec-title">1. ชุดข้อมูล</div>
      <div className="sec-sub">อัปโหลดไฟล์ของแต่ละชุด (หลายไฟล์/หลาย Sheet รวมเป็นตารางเดียวต่อชุดได้) เลือกระบบถ้าตรงกับ FC / JDA / MHT จะได้สูตรตั้งต้นให้</div>
      <div className="multi-ds">
        {sides.map((s) => (
          <UploadCard key={s.side} api={s} />
        ))}
      </div>
      <div className="row" style={{ marginBottom: 18 }}>
        {count < MAX_DS && (
          <button className="btn small" onClick={() => setCount(count + 1)}>
            ＋ เพิ่มชุดที่ {count + 1}
          </button>
        )}
        {count > 2 && (
          <button
            className="btn small"
            onClick={() => {
              const last = all[count - 1];
              if (last.files.length && !confirm(`เอา “${last.label}” ออก (ไฟล์ที่อัปโหลดไว้จะถูกล้าง)?`)) return;
              last.reset();
              setPairs((ps) => ps.filter((p) => p.a < count - 1 && p.b < count - 1));
              setCount(count - 1);
            }}
          >
            − เอาชุดที่ {count} ออก
          </button>
        )}
      </div>

      <div className="sec-title">2. เลือกคู่ที่จะเทียบ</div>
      <div className="sec-sub">เช่น ชุด 1 ↔ ชุด 2 และ ชุด 2 ↔ ชุด 3 — ชุดเดียวกันใช้ซ้ำได้หลายคู่ โดยไม่ต้องอัปโหลดใหม่</div>
      <div className="card">
        {usablePairs.map((p, i) => (
          <div className="row" key={p.id} style={{ marginBottom: 8 }}>
            <strong style={{ minWidth: 52 }}>คู่ {i + 1}</strong>
            <select className="select" style={{ maxWidth: 300 }} value={p.a} aria-label={`คู่ ${i + 1} ฝั่ง A`} onChange={(e) => setPair(p.id, { a: Number(e.target.value) })}>
              {sides.map((_, k) => (
                <option key={k} value={k}>
                  {nameOf(k)}
                </option>
              ))}
            </select>
            <span>↔</span>
            <select className="select" style={{ maxWidth: 300 }} value={p.b} aria-label={`คู่ ${i + 1} ฝั่ง B`} onChange={(e) => setPair(p.id, { b: Number(e.target.value) })}>
              {sides.map((_, k) => (
                <option key={k} value={k}>
                  {nameOf(k)}
                </option>
              ))}
            </select>
            {p.a === p.b && <span className="badge bad">เลือกชุดเดียวกันไม่ได้</span>}
            {usablePairs.length > 1 && (
              <button className="btn small danger" onClick={() => setPairs((ps) => ps.filter((x) => x.id !== p.id))}>
                🗑
              </button>
            )}
          </div>
        ))}
        {usablePairs.length < MAX_PAIRS && (
          <button
            className="btn small"
            onClick={() => {
              const id = `p${++pairSeq}`;
              setPairs((ps) => [...ps, { id, a: 0, b: 1 }]);
              setActive(id);
            }}
          >
            ＋ เพิ่มคู่
          </button>
        )}
      </div>

      <div className="sec-title">3. ตั้ง Mapping และ Compare ทีละคู่</div>
      {activePair && (
        <>
          <div className="seg" style={{ marginBottom: 12 }} role="tablist">
            {usablePairs.map((p, i) => {
              const st = status[p.id];
              return (
                <button key={p.id} className={activePair.id === p.id ? "on" : ""} onClick={() => setActive(p.id)} role="tab">
                  คู่ {i + 1}: {all[p.a].label} ↔ {all[p.b].label}
                  <span className="n">{st?.meta ? "✓ Compare แล้ว" : st?.built ? "Build แล้ว" : ""}</span>
                </button>
              );
            })}
          </div>

          {usablePairs.map((p) => {
            const sa = all[p.a];
            const sb = all[p.b];
            const ok = ready(sa) && ready(sb) && p.a !== p.b;
            return (
              <div key={p.id} style={{ display: activePair.id === p.id ? undefined : "none" }}>
                {ok ? (
                  <PairWorkspace
                    key={`${p.id}:${sa.side}:${sb.side}`}
                    a={sa}
                    b={sb}
                    pairId={p.id}
                    view={views[p.id] ?? "mapping"}
                    onView={(v) => setViews((x) => ({ ...x, [p.id]: v }))}
                    onBackToUpload={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    report={[]}
                    onReport={noop}
                    hideReport
                    onStatus={(s) => setStatus((x) => ({ ...x, [p.id]: s }))}
                  />
                ) : (
                  <Alert kind="info">
                    {p.a === p.b ? "เลือกสองชุดที่ต่างกันในหัวข้อ 2" : `อัปโหลดไฟล์ให้ครบทั้ง ${sa.label} และ ${sb.label} ก่อน แล้วจะตั้ง Mapping ของคู่นี้ได้`}
                  </Alert>
                )}
              </div>
            );
          })}
        </>
      )}

      <div className="sec-title" style={{ marginTop: 24 }}>4. สรุปรวมทุกคู่</div>
      <div className="card">
        {results.length === 0 ? (
          <div className="muted">Run Compare ในแต่ละคู่แล้วสรุปจะมาแสดงที่นี่ — คัดลอกเป็นข้อความรายงาน หรือ Export Excel ไฟล์เดียวที่รวมทุกคู่</div>
        ) : (
          <>
            <div className="tbl-wrap" style={{ maxHeight: 360, marginBottom: 12 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>หัวข้อ (แก้ได้)</th>
                    <th>Total</th>
                    <th>Match</th>
                    <th>Mismatch</th>
                    <th>Missing A</th>
                    <th>Missing B</th>
                    <th>Match %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((p, i) => {
                    const s = status[p.id]!.meta!.summary;
                    const bad = s.mismatch + s.missingA + s.missingB;
                    return (
                      <tr key={p.id}>
                        <td>{i + 1}</td>
                        <td>
                          <input
                            className="input"
                            style={{ minWidth: 260 }}
                            aria-label={`หัวข้อคู่ ${i + 1}`}
                            value={titles[p.id] ?? autoTitle(p)}
                            onChange={(e) => setTitles((t) => ({ ...t, [p.id]: e.target.value }))}
                          />
                        </td>
                        <td className="num">{s.total.toLocaleString()}</td>
                        <td className="num">{s.match.toLocaleString()}</td>
                        <td className="num">{s.mismatch.toLocaleString()}</td>
                        <td className="num">{s.missingA.toLocaleString()}</td>
                        <td className="num">{s.missingB.toLocaleString()}</td>
                        <td className="num">{s.total ? ((s.match / s.total) * 100).toFixed(2) : "0.00"} %</td>
                        <td>
                          <span className={`badge ${bad === 0 ? "ok" : "bad"}`}>{bad === 0 ? "Match" : "Not Match"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <textarea className="input" readOnly rows={Math.min(30, text.split("\n").length + 1)} style={{ width: "100%", fontFamily: "inherit", lineHeight: 1.5 }} value={text} onFocus={(e) => e.currentTarget.select()} aria-label="ข้อความรายงานรวม" />
            <div className="row" style={{ marginTop: 8 }}>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={totals} onChange={(e) => setTotals(e.target.checked)} />
                แสดงยอดรวม (Rows / ผลรวมแต่ละฝั่ง + %)
              </label>
              <span className="spacer" />
              <button className="btn small primary" onClick={copy}>
                {copied ? "✓ คัดลอกแล้ว" : "📋 คัดลอกข้อความรายงาน"}
              </button>
              <button className="btn primary" disabled={exporting} onClick={exportAll}>
                {exporting ? "กำลังสร้างไฟล์…" : "📥 Export Excel (ทุกคู่ในไฟล์เดียว)"}
              </button>
            </div>
            {exportErr && <Alert kind="bad">{exportErr}</Alert>}
          </>
        )}
      </div>

      <div className="footer">LOD · Reconcile Tools · เทียบหลายชุด · ประมวลผลบนเบราว์เซอร์</div>
    </div>
  );
}

function infoOf(s: SideApi) {
  return { system: s.system, files: s.files.map((f) => f.info.name), rowCount: s.table?.rowCount ?? 0 };
}
