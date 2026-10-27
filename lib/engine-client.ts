import type { Handlers } from "./engine.worker";

type Args<K extends keyof Handlers> = Parameters<Handlers[K]>[0];
type Ret<K extends keyof Handlers> = Awaited<ReturnType<Handlers[K]>>;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error ?? "เกิดข้อผิดพลาด"));
    };
    worker.onerror = (e) => {
      for (const [, p] of pending) p.reject(new Error(e.message || "Worker error"));
      pending.clear();
    };
  }
  return worker;
}

export function call<K extends keyof Handlers>(
  type: K,
  payload: Args<K>,
  transfer: Transferable[] = [],
): Promise<Ret<K>> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ id, type, payload }, transfer);
  });
}

export function download(data: BlobPart, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
