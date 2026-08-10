import { kvGet, kvRemove, kvSet } from "./kv";

/**
 * Borradores locales (autosave). Un borrador es un estado parcial de un
 * formulario (p. ej. una cotización sin terminar) que sobrevive a cierres
 * forzosos. Se guarda en el store durable (SQLite vía Rust).
 */

export interface Draft<T = unknown> {
  kind: string;
  data: T;
  updatedAt: number;
}

export async function saveDraft<T>(kind: string, data: T): Promise<void> {
  const draft: Draft<T> = { kind, data, updatedAt: Date.now() };
  await kvSet("draft:" + kind, JSON.stringify(draft));
}

export async function getDraft<T = unknown>(kind: string): Promise<Draft<T> | null> {
  try {
    const value = await kvGet("draft:" + kind);
    if (!value) return null;
    const parsed = JSON.parse(value) as Draft<T>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearDraft(kind: string): Promise<void> {
  await kvRemove("draft:" + kind);
}
