import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Detecta si el código corre dentro de la webview de Tauri (vs. navegador
 * en `npm run dev`). Permite que los módulos usen fallbacks a localStorage
 * cuando no hay backend Rust.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Invoca un comando de Rust. Falla con tauri-unavailable si no hay Tauri. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("tauri-unavailable");
  }
  return tauriInvoke<T>(cmd, args);
}
