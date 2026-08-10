import { collection, getDocs, limit, query } from "firebase/firestore";
import {
  APP_VERSION,
  getConfig,
  getConfigIssues,
} from "./config";
import { getDb } from "./firebase";
import { getStableInstanceId } from "./secure-store";
import { getNetworkState } from "./network";
import { fetchSolicitudes, pingWeb, sendHeartbeat } from "./web-api";
import type { IconName } from "../ui/icons";

export type CheckStatus = "checking" | "ok" | "warn" | "error";

export interface ConnectionCheck {
  id: string;
  label: string;
  icon: IconName;
  status: CheckStatus;
  detail: string;
  latencyMs: number | null;
}

const CHECK_DEFS: Array<Pick<ConnectionCheck, "id" | "label" | "icon">> = [
  { id: "red", label: "Red local", icon: "plug" },
  { id: "config", label: "Configuración (.env)", icon: "gear" },
  { id: "firestore", label: "Base de datos (Firestore)", icon: "database" },
  { id: "web", label: "Sitio web", icon: "globe" },
  { id: "heartbeat", label: "Heartbeat (secreto app)", icon: "heartPulse" },
  { id: "solicitudes", label: "API de solicitudes", icon: "fileText" },
];

export function initialChecks(): ConnectionCheck[] {
  return CHECK_DEFS.map((def) => ({
    ...def,
    status: "checking",
    detail: "Comprobando…",
    latencyMs: null,
  }));
}

export type OverallStatus = "ok" | "warn" | "error";

export function summarizeChecks(checks: ConnectionCheck[]): OverallStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }

  if (checks.some((check) => check.status === "warn" || check.status === "checking")) {
    return "warn";
  }

  return "ok";
}

/**
 * Ejecuta todas las comprobaciones en orden, notificando el progreso
 * con cada actualización parcial.
 */
export async function runConnectionChecks(
  onUpdate: (checks: ConnectionCheck[]) => void,
): Promise<ConnectionCheck[]> {
  const checks = initialChecks();

  const update = (id: string, patch: Partial<ConnectionCheck>): void => {
    const index = checks.findIndex((check) => check.id === id);

    if (index >= 0) {
      checks[index] = { ...checks[index], ...patch };
      onUpdate([...checks]);
    }
  };

  onUpdate([...checks]);

  // 1. Red local (estado en vivo de la máquina de conectividad)
  const red = getNetworkState();
  update(
    "red",
    red === "online"
      ? { status: "ok", detail: "Conectado a la red" }
      : red === "degraded"
        ? { status: "warn", detail: "Red disponible, servicio web con problemas" }
        : { status: "error", detail: "Sin conexión de red" },
  );

  // 2. Variables de entorno
  const config = getConfig();
  const issues = getConfigIssues(config);

  update(
    "config",
    issues.length === 0
      ? { status: "ok", detail: "Variables cargadas correctamente" }
      : { status: "error", detail: issues.join(" · ") },
  );

  // 3. Firestore (lectura pública del catálogo)
  const firestoreStarted = performance.now();

  try {
    const snapshot = await Promise.race([
      getDocs(query(collection(getDb(), "productos"), limit(5))),
      new Promise<never>((_, reject) =>
        window.setTimeout(
          () => reject(new Error("Tiempo de espera agotado (12 s)")),
          12_000,
        ),
      ),
    ]);

    update("firestore", {
      status: "ok",
      detail: `Lectura correcta (${snapshot.size} doc. de muestra en productos)`,
      latencyMs: Math.round(performance.now() - firestoreStarted),
    });
  } catch (error) {
    update("firestore", {
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - firestoreStarted),
    });
  }

  // 4. Sitio web en línea
  const web = await pingWeb();

  update(
    "web",
    web.ok
      ? {
          status: "ok",
           detail: `API web responde ${config.webUrl} (HTTP ${web.status})`,
          latencyMs: web.latencyMs,
        }
      : {
          status: "error",
          detail: web.error ?? "Sin respuesta",
          latencyMs: web.latencyMs > 0 ? web.latencyMs : null,
        },
  );

  // 5. Heartbeat con secreto compartido
  const heartbeat = await sendHeartbeat({
    version: APP_VERSION,
    instanceId: await getStableInstanceId(),
  });

  update(
    "heartbeat",
    heartbeat.ok
      ? {
          status: "ok",
          detail: "Heartbeat aceptado por la web",
          latencyMs: heartbeat.latencyMs,
        }
      : {
          status: heartbeat.status === 503 ? "warn" : "error",
          detail: heartbeat.error ?? "Error desconocido",
          latencyMs: heartbeat.latencyMs > 0 ? heartbeat.latencyMs : null,
        },
  );

  // 6. API de solicitudes (lectura vía web + Admin SDK)
  const solicitudes = await fetchSolicitudes("cotizaciones");

  update(
    "solicitudes",
    solicitudes.ok && solicitudes.data
      ? {
          status: "ok",
          detail: `${solicitudes.data.count} solicitudes accesibles`,
          latencyMs: solicitudes.latencyMs,
        }
      : {
          status: "error",
          detail: solicitudes.error ?? "Error desconocido",
          latencyMs: solicitudes.latencyMs > 0 ? solicitudes.latencyMs : null,
        },
  );

  return checks;
}
