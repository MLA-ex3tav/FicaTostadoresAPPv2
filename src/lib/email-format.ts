export const EMAIL_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
  "correo.cl",
  "gmail.cl",
  "hotmail.cl",
  "outlook.cl",
  "yahoo.cl",
  "microsoft.com",
  "protonmail.com",
  "zoho.com",
  "telia.com",
] as const;

export interface EmailSuggestion {
  domain: string;
  full: string;
  local: string;
}

function sanitizeLocal(local: string): string {
  return local.replace(/[^a-zA-Z0-9._%-]/g, "").slice(0, 64);
}

/**
 * Extrae la parte local (antes del @) del valor actual del campo.
 */
export function emailLocalPart(value: string): string {
  const at = value.lastIndexOf("@");
  if (at === -1) return value;
  return value.slice(0, at);
}

/**
 * Sugiere dominios para completar un correo en curso.
 * Devuelve un arreglo de dominios ordenados por relevancia:
 * primero los que empiezan con lo escrito, luego los que lo contienen.
 */
export function suggestEmailDomains(value: string): string[] {
  const at = value.lastIndexOf("@");
  if (at === -1) return [];

  const typed = value.slice(at + 1).toLowerCase().replace(/\s/g, "");

  if (!typed) {
    return [...EMAIL_DOMAINS].sort((a, b) => a.localeCompare(b));
  }

  const startsWith = EMAIL_DOMAINS.filter((domain) => domain.startsWith(typed));
  const contains = EMAIL_DOMAINS.filter(
    (domain) => !domain.startsWith(typed) && domain.includes(typed),
  );

  return [...startsWith, ...contains].slice(0, 6);
}

/**
 * Construye la sugerencia completa listo para insertar en el input.
 */
export function buildEmailSuggestion(
  value: string,
  domain: string,
): EmailSuggestion | null {
  const at = value.lastIndexOf("@");
  if (at === -1) return null;
  const local = sanitizeLocal(value.slice(0, at));
  return {
    domain,
    full: `${local}@${domain}`,
    local,
  };
}

/**
 * Decide si el valor del campo necesita autocompletado de dominio.
 */
export function needsEmailDomainCompletion(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at === -1) return false;
  const after = value.slice(at + 1);
  if (after.includes("@")) return false;
  if (after.includes(" ")) return false;
  if (!after) return true;
  const normalized = after.toLowerCase();
  return EMAIL_DOMAINS.every((domain) => !domain.startsWith(normalized));
}
