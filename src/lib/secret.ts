import { getConfig } from "./config";

/**
 * Resolución del secreto compartido con la web.
 *
 * Orden de preferencia:
 *  1. Valor guardado en el llavero del sistema (keyring) vía Rust — no queda
 *     embebido en el bundle del instalador.
 *  2. Variable de entorno VITE_COTIZACIONES_APP_SECRET (compatibilidad con
 *     versiones anteriores que compilaban el secreto dentro del JS).
 *
 * El frontend usa `getEffectiveSecret()` de forma síncrona; el valor del
 * keyring se hidrata al arrancar (ver secure-store.ts).
 */
let keyringOverride: string | null = null;

export function setSecretOverride(secret: string | null): void {
  const clean = secret?.trim() ?? "";
  keyringOverride = clean ? clean : null;
}

export function hasKeyringSecret(): boolean {
  return keyringOverride !== null;
}

export function getEffectiveSecret(): string {
  return keyringOverride ?? getConfig().appSecret;
}
