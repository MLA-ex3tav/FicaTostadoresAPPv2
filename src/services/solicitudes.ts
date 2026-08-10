import { enqueueOp } from "../lib/offline-queue";
import { getNetworkState, reportFailure } from "../lib/network";
import {
  actualizarEstadoSolicitud,
  actualizarCotizacionSolicitud,
  eliminarSolicitud,
  fetchSolicitudes,
  type RegistroOrdenTrabajoPayload,
  type SolicitudRemota,
} from "../lib/web-api";
import { mostrarTopLoader, ocultarTopLoader } from "../ui/loader";
import { showToast } from "../ui/toast";

export interface SolicitudesState {
  cotizaciones: SolicitudRemota[];
  soporte: SolicitudRemota[];
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  /** Refresco manual en curso (permite animar el botón de actualizar). */
  refreshing: boolean;
}

const state: SolicitudesState = {
  cotizaciones: [],
  soporte: [],
  loading: false,
  error: null,
  lastUpdatedAt: null,
  refreshing: false,
};

type SolicitudesListener = (state: SolicitudesState) => void;

const listeners = new Set<SolicitudesListener>();

function emit(): void {
  listeners.forEach((listener) => listener({ ...state }));
}

/** Firma breve de una lista de solicitudes para detectar si hubo cambios. */
function firmarSolicitudes(items: SolicitudRemota[]): string {
  return items
    .map(
      (item) =>
        `${item.id}:${String(item.estado ?? "")}:${item.enOT ? "1" : "0"}`,
    )
    .join("|");
}

export function subscribeSolicitudes(
  listener: SolicitudesListener,
): () => void {
  listeners.add(listener);
  listener({ ...state });

  return () => {
    listeners.delete(listener);
  };
}

const POLL_INTERVAL_MS = 30_000;

let pollTimer: number | null = null;
let refreshInFlight: Promise<void> | null = null;
let hasLoadedOnce = false;

export interface RefreshOptions {
  /** Refresco de fondo (no altera el estado de `loading`/`refreshing` de la UI). */
  silent?: boolean;
}

/**
 * Recarga cotizaciones y soporte desde la web.
 * - En el auto-refresco (`silent: true`) se ejecuta en segundo plano sin
 *   mostrar "actualizando…" ni animaciones en la UI.
 * - En el refresco manual (botón / menú contextual) marca `refreshing` para
 *   animar el botón de actualizar.
 */
export async function refreshSolicitudes(options?: RefreshOptions): Promise<void> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const silent = options?.silent ?? false;

  refreshInFlight = (async () => {
    if (!silent) {
      mostrarTopLoader();
      if (!hasLoadedOnce) {
        state.loading = true;
      } else {
        state.refreshing = true;
      }
      emit();
    }

    try {
      if (silent && getNetworkState() === "offline") {
        state.error = "Sin conexión. Los datos se recargarán al reconectar.";
        emit();
        return;
      }

      const [cotizaciones, soporte] = await Promise.all([
        fetchSolicitudes("cotizaciones"),
        fetchSolicitudes("soporte"),
      ]);

      if (cotizaciones.status === null || soporte.status === null) {
        reportFailure();
      }

      const nuevasCotizaciones: SolicitudRemota[] = [];
      if (cotizaciones.ok && cotizaciones.data) {
        const seen = new Map<string, SolicitudRemota>();
        for (const item of cotizaciones.data.solicitudes) {
          const key = item.id;
          if (!seen.has(key)) {
            seen.set(key, item);
          }
        }
        nuevasCotizaciones.push(...Array.from(seen.values()));
      }

      const nuevasSoporte: SolicitudRemota[] = soporte.ok && soporte.data
        ? soporte.data.solicitudes
        : state.soporte;

      const errors = [cotizaciones, soporte]
        .filter((result) => !result.ok)
        .map((result) => result.error);
      const nuevoError = errors.length > 0 ? errors.join(" · ") : null;

      const huboCambios =
        firmarSolicitudes(state.cotizaciones) !==
          firmarSolicitudes(nuevasCotizaciones) ||
        firmarSolicitudes(state.soporte) !== firmarSolicitudes(nuevasSoporte) ||
        state.error !== nuevoError;

      state.cotizaciones = nuevasCotizaciones;
      state.soporte = nuevasSoporte;
      state.error = nuevoError;

      if (!silent && hasLoadedOnce && !huboCambios) {
        showToast({
          title: "Sin cambios",
          message: "Los datos ya están actualizados.",
          tone: "info",
          icon: "check",
          durationMs: 3000,
        });
      }
    } finally {
      if (!silent) {
        ocultarTopLoader();
      }
      state.loading = false;
      state.refreshing = false;
      state.lastUpdatedAt = Date.now();
      hasLoadedOnce = true;
      emit();
    }
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export function startSolicitudesPolling(): void {
  stopSolicitudesPolling();

  // Las llamadas a Firebase se priorizan: en cuanto la app recupera el foco
  // (o la pestaña pasa a estar visible) se hace un fetch inmediato, además
  // del polling periódico en segundo plano.
  document.addEventListener("visibilitychange", onPriorityRefresh);
  window.addEventListener("focus", onPriorityRefresh);

  // Primera carga: se muestra (la UI está vacía). Las siguientes van silenciosas.
  void refreshSolicitudes();
  pollTimer = window.setInterval(
    () => void refreshSolicitudes({ silent: true }),
    POLL_INTERVAL_MS,
  );
}

function onPriorityRefresh(): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return;
  }
  void refreshSolicitudes({ silent: true });
}

export function stopSolicitudesPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  document.removeEventListener("visibilitychange", onPriorityRefresh);
  window.removeEventListener("focus", onPriorityRefresh);
}

/* ── Helpers de dominio ── */

const ESTADOS_CERRADOS = new Set([
  "en_cotizacion",
  "aprobada_ot",
  "rechazada",
  "completada",
]);

export function isSolicitudPendiente(item: SolicitudRemota): boolean {
  const estado = item.estado;

  if (typeof estado !== "string" || !estado.trim()) {
    return true;
  }

  return !ESTADOS_CERRADOS.has(estado);
}

/** Encola una mutación cuando no hay conexión (se reenvía al reconectar). */
function esErrorDeRed(result: { status: number | null }): boolean {
  return result.status === null || getNetworkState() === "offline";
}

export async function aprobarCotizacion(
  id: string,
): Promise<{ ok: boolean; error: string | null }> {
  const result = await actualizarEstadoSolicitud(id, "aprobada_ot");

  if (esErrorDeRed(result)) {
    await enqueueOp("set_estado", { id, estado: "aprobada_ot" });
    return { ok: true, error: null };
  }

  if (result.ok) {
    await refreshSolicitudes();
    return { ok: true, error: null };
  }

  return { ok: false, error: result.error ?? "Error desconocido" };
}

export async function rechazarCotizacion(
  id: string,
): Promise<{ ok: boolean; error: string | null }> {
  const result = await actualizarEstadoSolicitud(id, "rechazada");

  if (esErrorDeRed(result)) {
    await enqueueOp("set_estado", { id, estado: "rechazada" });
    return { ok: true, error: null };
  }

  if (result.ok) {
    await refreshSolicitudes();
    return { ok: true, error: null };
  }

  return { ok: false, error: result.error ?? "Error desconocido" };
}

/** Cambia la etapa de una OT; offline se encola y se aplica al reconectar. */
export async function avanzarEstadoSolicitud(
  id: string,
  estado: string,
): Promise<{ ok: boolean; error: string | null; queued: boolean }> {
  if (getNetworkState() === "offline") {
    await enqueueOp("set_estado", { id, estado });
    return { ok: true, error: null, queued: true };
  }

  const result = await actualizarEstadoSolicitud(id, estado);

  if (esErrorDeRed(result)) {
    await enqueueOp("set_estado", { id, estado });
    return { ok: true, error: null, queued: true };
  }

  if (result.ok) {
    await refreshSolicitudes();
    return { ok: true, error: null, queued: false };
  }

  return { ok: false, error: result.error ?? "Error desconocido", queued: false };
}

export function getSolicitudDate(item: SolicitudRemota): Date | null {
  const value = item.createdAt;

  if (typeof value !== "string" || !value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/* ── Edición y borrado vía API (menú contextual) ── */

/** Edita una cotización EXISTENTE (PATCH in-place, no crea copia). */
export async function actualizarCotizacionRemota(
  id: string,
  payload: Omit<RegistroOrdenTrabajoPayload, "id"> &
    Partial<{ estado: string; enOT: boolean }>,
): Promise<{ ok: boolean; error: string | null; queued: boolean }> {
  if (getNetworkState() === "offline") {
    await enqueueOp("update_cotizacion", { id, campos: payload });
    return { ok: true, error: null, queued: true };
  }

  try {
    const result = await actualizarCotizacionSolicitud(id, payload);

    if (esErrorDeRed(result)) {
      await enqueueOp("update_cotizacion", { id, campos: payload });
      return { ok: true, error: null, queued: true };
    }

    if (result.ok) {
      await refreshSolicitudes();
      return { ok: true, error: null, queued: false };
    }

    return { ok: false, error: result.error ?? "No se pudo actualizar la cotización.", queued: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Error desconocido",
      queued: false,
    };
  }
}

/** Elimina permanentemente una solicitud (cotización / OT / soporte). */
export async function eliminarSolicitudRemota(
  id: string,
): Promise<{ ok: boolean; error: string | null; queued: boolean }> {
  if (getNetworkState() === "offline") {
    await enqueueOp("delete_solicitud", { id });
    return { ok: true, error: null, queued: true };
  }

  try {
    const result = await eliminarSolicitud(id);

    if (esErrorDeRed(result)) {
      await enqueueOp("delete_solicitud", { id });
      return { ok: true, error: null, queued: true };
    }

    if (result.ok) {
      await refreshSolicitudes();
      return { ok: true, error: null, queued: false };
    }

    return { ok: false, error: result.error ?? "No se pudo eliminar la solicitud.", queued: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      queued: false,
    };
  }
}
