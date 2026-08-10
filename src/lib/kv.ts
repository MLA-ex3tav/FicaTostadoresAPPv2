import { invoke, isTauri } from "./runtime";

/**
 * Almacén clave/valor durable: SQLite (vía Rust) dentro de Tauri, con
 * fallback a localStorage cuando se ejecuta en navegador (dev sin Tauri).
 * Los datos sobreviven cierres forzosos y borrados del almacén de la webview.
 */

const LS_PREFIX = "fica-kv:";

export async function kvGet(key: string): Promise<string | null> {
  if (isTauri()) {
    return (await invoke<string | null>("kv_get", { key })) ?? null;
  }
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (isTauri()) {
    await invoke<void>("kv_set", { key, value });
    return;
  }
  try {
    localStorage.setItem(LS_PREFIX + key, value);
  } catch {
    /* sin almacenamiento disponible */
  }
}

export async function kvRemove(key: string): Promise<string | null> {
  if (isTauri()) {
    return (await invoke<string | null>("kv_remove", { key })) ?? null;
  }
  try {
    const value = localStorage.getItem(LS_PREFIX + key);
    localStorage.removeItem(LS_PREFIX + key);
    return value;
  } catch {
    return null;
  }
}

export async function kvList(prefix: string): Promise<Array<[string, string]>> {
  if (isTauri()) {
    return await invoke<Array<[string, string]>>("kv_list", { prefix });
  }
  try {
    const out: Array<[string, string]> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(LS_PREFIX + prefix)) {
        const value = localStorage.getItem(key);
        if (value !== null) {
          out.push([key.slice(LS_PREFIX.length), value]);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
