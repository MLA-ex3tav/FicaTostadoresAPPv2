import { flushQueue, registerExecutor } from "../lib/offline-queue";
import {
  actualizarEstadoSolicitud,
  actualizarCotizacionSolicitud,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  eliminarSolicitud,
  registrarOrdenTrabajo,
  type ProductoUpdate,
  type RegistroOrdenTrabajoPayload,
} from "../lib/web-api";
import { syncAllPreciosToServer } from "./catalog";
import { refreshSolicitudes } from "./solicitudes";

interface SetEstadoPayload {
  id: string;
  estado: string;
}

interface UpdateCotizacionPayload {
  id: string;
  campos: Omit<RegistroOrdenTrabajoPayload, "id"> &
    Partial<{ estado: string; enOT: boolean }>;
}

interface DeleteSolicitudPayload {
  id: string;
}

interface RegistrarOtPayload {
  payload: RegistroOrdenTrabajoPayload;
}

interface ProductoPayload {
  id?: string;
  campos?: ProductoUpdate;
}

/**
 * Registra los ejecutores de la cola offline y el flush posterior.
 * Debe llamarse una vez al arrancar (main.ts).
 */
export function registerQueueExecutors(): void {
  registerExecutor("set_estado", async (payload: unknown) => {
    const { id, estado } = payload as SetEstadoPayload;
    return (await actualizarEstadoSolicitud(id, estado)).ok;
  });

  registerExecutor("update_cotizacion", async (payload: unknown) => {
    const { id, campos } = payload as UpdateCotizacionPayload;
    return (await actualizarCotizacionSolicitud(id, campos)).ok;
  });

  registerExecutor("registrar_ot", async (payload: unknown) => {
    const { payload: body } = payload as RegistrarOtPayload;
    return (await registrarOrdenTrabajo(body)).ok;
  });

  registerExecutor("delete_solicitud", async (payload: unknown) => {
    const { id } = payload as DeleteSolicitudPayload;
    return (await eliminarSolicitud(id)).ok;
  });

  registerExecutor("crear_producto", async (payload: unknown) => {
    const { campos } = payload as ProductoPayload;
    return (await crearProducto(campos ?? {})).ok;
  });

  registerExecutor("actualizar_producto", async (payload: unknown) => {
    const { id, campos } = payload as ProductoPayload;
    return (await actualizarProducto(id ?? "", campos ?? {})).ok;
  });

  registerExecutor("eliminar_producto", async (payload: unknown) => {
    const { id } = payload as ProductoPayload;
    return (await eliminarProducto(id ?? "")).ok;
  });
}

/** Al terminar un flush exitoso: reenvía precios pendientes y recarga datos. */
export async function postFlushSync(): Promise<void> {
  void syncAllPreciosToServer();
  await refreshSolicitudes({ silent: true }).catch(() => {
    /* sin conexión */
  });
}

/** Útil para acciones manuales de "sincronizar ahora". */
export async function syncNow(): Promise<{ sent: number; failed: number }> {
  const result = await flushQueue();
  await postFlushSync();
  return result;
}
