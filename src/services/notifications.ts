import { kvGet, kvSet } from "../lib/kv";
import { isSolicitudPendiente, subscribeSolicitudes } from "./solicitudes";
import { navigateTo } from "../ui/sidebar";
import { showToast } from "../ui/toast";

/**
 * Notificaciones de escritorio para nuevas cotizaciones y solicitudes de
 * soporte. Usa la API Notification del sistema (funciona en la webview de
 * Tauri); si no hay permiso, cae a un toast.
 *
 * La primera ejecución de la instalación establece una línea base (no notifica
 * lo ya existente). Las siguientes notifican lo nuevo desde la última vez que
 * se vio, incluso si llegó con la app cerrada.
 */

const SEEN_KEY = "notif-seen-solicitudes";

let seen = new Set<string>();
let firstRun = true;
let unsubscribe: (() => void) | null = null;

function itemsPending(items: Array<{ id: string; [k: string]: unknown }>): Array<{ id: string; [k: string]: unknown }> {
  return items.filter((item) => isSolicitudPendiente(item));
}

function nuevasPendientes(
  items: Array<{ id: string; [k: string]: unknown }>,
): Array<{ id: string; [k: string]: unknown }> {
  return itemsPending(items).filter((item) => !seen.has(item.id));
}

function extraerNombre(item: { [k: string]: unknown }): string {
  const value =
    typeof item.clientName === "string" && item.clientName.trim()
      ? item.clientName.trim()
      : typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : "";
  return value;
}

function resumenProductos(item: { [k: string]: unknown }): string {
  if (!Array.isArray(item.products) || item.products.length === 0) {
    return "";
  }
  const nombres = item.products
    .map((product) =>
      product && typeof product === "object" && "name" in product
        ? String((product as { name?: unknown }).name ?? "")
        : "",
    )
    .filter((name) => name.trim());
  if (nombres.length === 0) return "";
  return nombres[0] + (nombres.length > 1 ? ` +${nombres.length - 1}` : "");
}

async function persistSeen(): Promise<void> {
  try {
    await kvSet(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* almacenamiento no disponible */
  }
}

function mostrarNotificacion(
  title: string,
  body: string,
  view: "cotizaciones" | "soporte",
): void {
  const icon = "/assets/logo.webp";

  const fallback = (): void => {
    showToast({
      title,
      message: body,
      tone: "info",
      icon: view === "cotizaciones" ? "fileText" : "headphones",
      durationMs: 8000,
    });
  };

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notification = new Notification(title, { body, icon });
      notification.onclick = () => {
        window.focus();
        navigateTo(view);
        notification.close();
      };
      return;
    } catch {
      fallback();
    }
  } else {
    fallback();
  }
}

async function requestPermission(): Promise<void> {
  if (!("Notification" in window)) return;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    /* sin soporte de notificaciones */
  }
}

/**
 * Inicializa las notificaciones de escritorio. Devuelve una función para
 * cancelar la suscripción al estado de solicitudes.
 */
export async function initNotifications(): Promise<() => void> {
  await requestPermission();

  try {
    const raw = await kvGet(SEEN_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        seen = new Set(parsed.filter((id): id is string => typeof id === "string"));
      }
    }
  } catch {
    /* primer uso */
  }

  firstRun = seen.size === 0;

  unsubscribe = subscribeSolicitudes((state) => {
    const cotizaciones = Array.isArray(state.cotizaciones)
      ? (state.cotizaciones as Array<{ id: string; [k: string]: unknown }>)
      : [];
    const soporte = Array.isArray(state.soporte)
      ? (state.soporte as Array<{ id: string; [k: string]: unknown }>)
      : [];

    const nuevasC = nuevasPendientes(cotizaciones);
    const nuevasS = nuevasPendientes(soporte);

    if (!firstRun) {
      for (const item of nuevasC) {
        const nombre = extraerNombre(item);
        const productos = resumenProductos(item);
        mostrarNotificacion(
          "Nueva cotización",
          nombre
            ? `${nombre}${productos ? ` — ${productos}` : ""}`
            : "Se recibió una nueva cotización.",
          "cotizaciones",
        );
      }
      for (const item of nuevasS) {
        mostrarNotificacion(
          "Soporte técnico",
          extraerNombre(item) || "Se recibió una nueva solicitud de soporte.",
          "soporte",
        );
      }
    } else {
      firstRun = false;
    }

    cotizaciones.forEach((item) => seen.add(item.id));
    soporte.forEach((item) => seen.add(item.id));

    void persistSeen();
  });

  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

export function stopNotifications(): void {
  unsubscribe?.();
  unsubscribe = null;
}
