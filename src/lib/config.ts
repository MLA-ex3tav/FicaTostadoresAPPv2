export const APP_VERSION = "0.2.0";

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface AppConfig {
  /** URL base de FicaTostadoresWEB (sin slash final). */
  webUrl: string;
  /** Secreto compartido con la web (Authorization: Bearer …). */
  appSecret: string;
  firebase: FirebaseClientConfig;
}

function cleanUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function getConfig(): AppConfig {
  const env = import.meta.env;

  return {
    webUrl: cleanUrl(env.VITE_WEB_API_URL ?? ""),
    appSecret: (env.VITE_COTIZACIONES_APP_SECRET ?? "").trim(),
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY ?? "",
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
      projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
      appId: env.VITE_FIREBASE_APP_ID ?? "",
    },
  };
}

export function getConfigIssues(config: AppConfig = getConfig()): string[] {
  const issues: string[] = [];

  if (!config.webUrl) {
    issues.push("Falta VITE_WEB_API_URL");
  }

  if (!config.appSecret) {
    issues.push("Falta VITE_COTIZACIONES_APP_SECRET");
  }

  const missingFirebase = Object.entries(config.firebase)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingFirebase.length > 0) {
    issues.push(`Firebase incompleta: ${missingFirebase.join(", ")}`);
  }

  return issues;
}

let cachedInstanceId: string | null = null;

/** Hidrata la caché con el ID de instancia de Rust (SQLite) al arrancar. */
export function hydrateInstanceId(id: string): void {
  if (!id) return;
  cachedInstanceId = id;
  try {
    localStorage.setItem("fica-instance-id", id);
  } catch {
    /* sin almacenamiento */
  }
}

/** ID estable de esta instalación (se envía en el heartbeat). */
export function getInstanceId(): string {
  if (cachedInstanceId) {
    return cachedInstanceId;
  }

  try {
    const stored = localStorage.getItem("fica-instance-id");

    if (stored) {
      cachedInstanceId = stored;
      return stored;
    }

    const generated = crypto.randomUUID();
    localStorage.setItem("fica-instance-id", generated);
    cachedInstanceId = generated;
    return generated;
  } catch {
    cachedInstanceId = "desconocido";
    return cachedInstanceId;
  }
}
