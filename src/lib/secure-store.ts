import { getInstanceId } from "./config";
import { invoke } from "./runtime";
import { setSecretOverride } from "./secret";

/**
 * Acceso seguro a secretos e identidad de la instalación, delegando a Rust
 * (keyring + SQLite) cuando corre dentro de Tauri.
 */

/** Lee el secreto del llavero del sistema (si está configurado). */
export async function loadKeyringSecret(): Promise<string | null> {
  try {
    const value = await invoke<string>("get_app_secret");
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

/** Hidrata el override del secreto al arrancar la app. */
export async function hydrateSecret(): Promise<void> {
  setSecretOverride(await loadKeyringSecret());
}

/** Guarda el secreto en el llavero del sistema (fuente de verdad). */
export async function setAppSecret(secret: string): Promise<void> {
  const clean = secret.trim();
  if (!clean) {
    throw new Error("El secreto no puede estar vacío.");
  }
  try {
    await invoke<void>("set_app_secret", { secret: clean });
    setSecretOverride(clean);
  } catch {
    throw new Error("No se pudo guardar el secreto en el llavero del sistema.");
  }
}

/**
 * ID estable de la instalación con el backend Rust como fuente de verdad
 * (SQLite). En navegador usa el fallback de localStorage.
 */
export async function getStableInstanceId(): Promise<string> {
  try {
    const id = await invoke<string>("get_instance_id");
    if (id) {
      return id;
    }
  } catch {
    /* sin Tauri */
  }
  return getInstanceId();
}
