"use client";
import { useRef, useState } from "react";
import { call, download } from "@/lib/engine-client";
import { sheetKey, type SideApi } from "@/lib/useSide";
import { SYSTEMS, SYSTEM_LABELS } from "@/lib/types";
import { Alert, PreviewTable, Spinner } from "./ui";

const WARN_MB = 50;

function UploadCard({ api }: { api: SideApi }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const totalMb = api.files.reduce((s, f) => s + f.info.size, 0) / 1048576;
  const label = api.side.toUpperCase();

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="card-label" style={{ margin: 0 }}>
          ไฟล์ {label} — ระบบ
        </div>
        <div className="seg">
          {SYSTEMS.map((s) => (
            <button key={s} className={api.system === s ? "on" : ""} onClick={() => api.setSystem(s)}>
              {SYSTEM_LABELS[s]}
            </button>
          ))}
        </div>
        {api.autoDetected && <span className="badge info" title="ตรวจจากหัวตารางของไฟล์ — กดเลือกระบบเองได้">ตรวจพบอัตโนมัติ</span>}
      </div>

      <div
        className={`drop ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) void api.addFiles(e.dataTransfer.files);
        }}
      >
        <div style={{ fontWeight: 600 }}>ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</div>
        <div className="muted">CSV · XLSX · XLS — เลือกได้หลายไฟล์ (จะรวมเป็นตารางเดียว)</div>
        <input
          ref={input}
          type="file"
          multiple
          accept=".csv,.xlsx,.xls,.xlsm"
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void api.addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {totalMb > WARN_MB && (
        <Alert kind="warn">
          ไฟล์ฝั่ง {label} รวมกัน {totalMb.toFixed(1)} MB — ประมวลผลได้ แต่อาจใช้ memory ของเบราว์เซอร์มาก
        </Alert>
      )}
      {api.errors.length > 0 && (
        <Alert kind="bad">
          <ul>
            {api.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      {api.files.map((f) => {
        const multi = f.info.isExcel && f.info.sheets.length > 1;
        return (
          <div className="file-item" key={f.info.id}>
            <div className="file-head">
              <span className="file-name" title={f.info.name}>
                📄 {f.info.name}
              </span>
              <span className="muted">{(f.info.size / 1048576).toFixed(2)} MB</span>
              <span className="spacer" />
              <button className="btn small danger" onClick={() => api.removeFile(f.info.id)}>
                ลบ
              </button>
            </div>
            {multi && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted">Sheets ที่จะรวม:</span>
                {f.info.sheets.map((s) => {
                  const on = f.selected.includes(s);
                  return (
                    <label key={String(s)} className="row" style={{ gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => api.updateFile(f.info.id, { selected: on ? f.selected.filter((x) => x !== s) : [...f.selected, s] })}
                      />
                      {s}
                    </label>
                  );
                })}
              </div>
            )}
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ cursor: "pointer" }}>
                ตั้งค่าแถว Header (ค่าเริ่มต้น = แถวที่ 1)
              </summary>
              <div className="row" style={{ marginTop: 8 }}>
                {f.selected.map((s) => (
                  <label key={String(s)} className="row" style={{ gap: 6 }}>
                    <span className="muted">{s ? `Sheet '${s}'` : "Header อยู่แถวที่"}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={1000}
                      style={{ width: 80 }}
                      value={f.headerRows[sheetKey(s)] ?? 1}
                      onChange={(e) =>
                        api.updateFile(f.info.id, { headerRows: { ...f.headerRows, [sheetKey(s)]: Math.max(1, Number(e.target.value) || 1) } })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          </div>
        );
      })}

      {api.busy && (
        <div style={{ marginTop: 10 }}>
          <Spinner label="กำลังอ่านและรวมไฟล์…" />
        </div>
      )}

      {api.table && (
        <>
          <hr className="s" />
          <Alert kind="ok">
            ✅ {api.displayName} พร้อมใช้งาน — {api.table.rowCount.toLocaleString()} แถว × {api.table.columns.length} คอลัมน์
          </Alert>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Preview 10 แถว</summary>
            <div style={{ marginTop: 8 }}>
              <PreviewTable columns={api.table.columns} rows={api.table.preview} />
            </div>
          </details>
          <div style={{ marginTop: 10 }}>
            <button
              className="btn small"
              onClick={async () => {
                const csv = await call("exportRaw", { side: api.side });
                download(csv, `Raw_${label}_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
              }}
            >
              📥 Export ข้อมูลดิบ (CSV)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function UploadStep({ a, b, onSwap, onReset, onNext }: { a: SideApi; b: SideApi; onSwap: () => void; onReset: () => void; onNext: () => void }) {
  const ready = a.table && b.table;
  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <div>
          <div className="sec-title">Upload Source Files</div>
          <div className="sec-sub" style={{ marginBottom: 0 }}>
            อัปโหลดแล้วระบบรวมไฟล์และตรวจจับระบบ (FC / JDA / MHT) ให้อัตโนมัติ — เลือกคู่ระบบถูกต้องแล้วจะได้สูตรตั้งต้นทันที
          </div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={onSwap} title="สลับไฟล์/ระบบระหว่าง A และ B">
          🔄 สลับ A ↔ B
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm("ล้างไฟล์ที่อัปโหลดและผลลัพธ์ทั้งหมด เริ่มใหม่ตั้งแต่ต้น?")) onReset();
          }}
        >
          🗑 Reset
        </button>
      </div>
      <div style={{ height: 14 }} />
      <div className="grid2">
        <UploadCard api={a} />
        <UploadCard api={b} />
      </div>
      <div className="row">
        {ready ? (
          <span className="badge ok">
            ทั้งสองไฟล์พร้อมแล้ว · {a.system} ↔ {b.system}
          </span>
        ) : (
          <span className="muted">กรุณาอัปโหลดทั้งสองฝั่ง</span>
        )}
        <span className="spacer" />
        <button className="btn primary" disabled={!ready} onClick={onNext}>
          ถัดไป: ตรวจสูตร →
        </button>
      </div>
    </div>
  );
}
