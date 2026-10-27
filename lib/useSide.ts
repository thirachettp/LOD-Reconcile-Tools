"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "./engine-client";
import type { FileInfo, SheetRequest } from "./io";
import type { TableMeta } from "./engine.worker";
import { detectSystem } from "./presets";
import type { SystemCode } from "./types";

export interface FileState {
  info: FileInfo;
  selected: (string | null)[];
  headerRows: Record<string, number>;
}

export const sheetKey = (s: string | null) => s ?? "__csv";

export interface SideApi {
  side: "a" | "b";
  system: SystemCode;
  autoDetected: boolean;
  setSystem: (s: SystemCode) => void;
  files: FileState[];
  table: TableMeta | null;
  busy: boolean;
  errors: string[];
  addFiles: (list: FileList | File[]) => Promise<void>;
  removeFile: (id: string) => void;
  updateFile: (id: string, patch: Partial<Pick<FileState, "selected" | "headerRows">>) => void;
  reset: () => void;
  displayName: string;
  snapshot: () => SideSnapshot;
  restore: (s: SideSnapshot) => void;
}

export interface SideSnapshot {
  system: SystemCode;
  autoDetected: boolean;
  manual: boolean;
  files: FileState[];
}

let fileSeq = 0;

export function useSide(side: "a" | "b", initial: SystemCode, onChanged: () => void): SideApi {
  const [system, setSystemRaw] = useState<SystemCode>(initial);
  const [autoDetected, setAuto] = useState(false);
  const manual = useRef(false);
  const [files, setFiles] = useState<FileState[]>([]);
  const [table, setTable] = useState<TableMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const setSystem = useCallback((s: SystemCode) => {
    manual.current = true;
    setAuto(false);
    setSystemRaw(s);
  }, []);

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      setBusy(true);
      const errs: string[] = [];
      for (const f of Array.from(list)) {
        try {
          if (!/\.(csv|xlsx|xls|xlsm)$/i.test(f.name)) throw new Error("รองรับเฉพาะ .csv .xlsx .xls");
          const buf = await f.arrayBuffer();
          const id = `${side}${++fileSeq}`;
          const info = await call("loadFile", { id, name: f.name, size: f.size, buf }, [buf]);
          setFiles((prev) => [
            ...prev,
            { info, selected: [...info.sheets], headerRows: Object.fromEntries(info.sheets.map((s) => [sheetKey(s), 1])) },
          ]);
        } catch (e) {
          errs.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setErrors(errs);
      setBusy(false);
    },
    [side],
  );

  const removeFile = useCallback((id: string) => {
    void call("dropFile", { id });
    setFiles((prev) => prev.filter((f) => f.info.id !== id));
  }, []);

  const updateFile = useCallback((id: string, patch: Partial<Pick<FileState, "selected" | "headerRows">>) => {
    setFiles((prev) => prev.map((f) => (f.info.id === id ? { ...f, ...patch } : f)));
  }, []);

  const reset = useCallback(() => {
    files.forEach((f) => void call("dropFile", { id: f.info.id }));
    setFiles([]);
    setTable(null);
    setErrors([]);
    manual.current = false;
    setAuto(false);
  }, [files]);

  // รวมไฟล์/Sheet อัตโนมัติเมื่อเปลี่ยนการเลือก (ไม่ต้องกดปุ่มรวม)
  const sig = JSON.stringify(files.map((f) => [f.info.id, f.selected, f.headerRows]));
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const reqs: SheetRequest[] = files.flatMap((f) =>
        f.selected.map((s) => ({ fileId: f.info.id, sheet: s, headerRow: f.headerRows[sheetKey(s)] ?? 1 })),
      );
      setBusy(true);
      try {
        const r = await call("combine", { side, reqs });
        if (cancelled) return;
        setTable(r.meta);
        setErrors(r.errors);
        changedRef.current();
      } catch (e) {
        if (!cancelled) setErrors([e instanceof Error ? e.message : String(e)]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, side]);

  // ตรวจจับระบบจากหัวตารางอัตโนมัติ (ยกเว้นผู้ใช้เลือกเอง)
  const colsKey = table ? table.columns.join("\u0001") : "";
  useEffect(() => {
    if (!table || manual.current) return;
    const d = detectSystem(table.columns);
    if (d) {
      setSystemRaw(d.system);
      setAuto(true);
    } else {
      setAuto(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colsKey]);

  const snapshot = useCallback(
    (): SideSnapshot => ({ system, autoDetected, manual: manual.current, files }),
    [system, autoDetected, files],
  );
  const restore = useCallback((s: SideSnapshot) => {
    manual.current = s.manual;
    setAuto(s.autoDetected);
    setSystemRaw(s.system);
    setFiles(s.files);
    if (s.files.length === 0) setTable(null);
  }, []);

  const names = files.map((f) => f.info.name);
  const displayName =
    names.length === 0
      ? side.toUpperCase()
      : names.length === 1
        ? names[0].length > 40
          ? names[0].slice(0, 37) + "…"
          : names[0]
        : `${names[0].length > 26 ? names[0].slice(0, 23) + "…" : names[0]} +${names.length - 1} ไฟล์`;

  return { side, system, autoDetected, setSystem, files, table, busy, errors, addFiles, removeFile, updateFile, reset, displayName, snapshot, restore };
}
