import {
  actualizarEstadoSolicitud,
  actualizarCotizacionSolicitud,
  eliminarSolicitud,
  fetchSolicitudes,
  type RegistroOrdenTrabajoPayload,
  type SolicitudRemota,
} from "../lib/web-api";

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
      if (!hasLoadedOnce) {
        state.loading = true;
      } else {
        state.refreshing = true;
      }
      emit();
    }

    const [cotizaciones, soporte] = await Promise.all([
      fetchSolicitudes("cotizaciones"),
      fetchSolicitudes("soporte"),
    ]);

    if (cotizaciones.ok && cotizaciones.data) {
      const seen = new Map<string, SolicitudRemota>();
      for (const item of cotizaciones.data.solicitudes) {
        const key = item.id;
        if (!seen.has(key)) {
          seen.set(key, item);
        }
      }
      state.cotizaciones = Array.from(seen.values());
    }

    if (soporte.ok && soporte.data) {
      state.soporte = soporte.data.solicitudes;
    }

    const errors = [cotizaciones, soporte]
      .filter((result) => !result.ok)
      .map((result) => result.error);

    state.error = errors.length > 0 ? errors.join(" · ") : null;
    state.loading = false;
    state.refreshing = false;
    state.lastUpdatedAt = Date.now();
    hasLoadedOnce = true;
    emit();
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

export async function aprobarCotizacion(
  id: string,
): Promise<{ ok: boolean; error: string | null }> {
  const result = await actualizarEstadoSolicitud(id, "aprobada_ot");

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

  if (result.ok) {
    await refreshSolicitudes();
    return { ok: true, error: null };
  }

  return { ok: false, error: result.error ?? "Error desconocido" };
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
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const result = await actualizarCotizacionSolicitud(id, payload);

    if (result.ok) {
      await refreshSolicitudes();
      return { ok: true, error: null };
    }

    return { ok: false, error: result.error ?? "No se pudo actualizar la cotización." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

/** Elimina permanentemente una solicitud (cotización / OT / soporte). */
export async function eliminarSolicitudRemota(
  id: string,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const result = await eliminarSolicitud(id);

    if (result.ok) {
      await refreshSolicitudes();
      return { ok: true, error: null };
    }

    return { ok: false, error: result.error ?? "No se pudo eliminar la solicitud." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
