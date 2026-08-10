import { getConfig } from "./config";
import { getEffectiveSecret } from "./secret";

export interface ApiResult<T> {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  data: T | null;
  error: string | null;
}

function ok<T>(status: number, latencyMs: number, data: T): ApiResult<T> {
  return { ok: true, status, latencyMs, data, error: null };
}

function fail<T>(
  status: number | null,
  latencyMs: number,
  error: string,
): ApiResult<T> {
  return { ok: false, status, latencyMs, data: null, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authHeaders(): HeadersInit {
  const appSecret = getEffectiveSecret();
  return appSecret ? { Authorization: `Bearer ${appSecret}` } : {};
}

async function readApiError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

/** Sube una imagen de producto a la web (Vercel Blob). variant: "product" | "carousel". */
export async function subirImagenProducto(
  blob: Blob,
  variant: "product" | "carousel" = "product",
): Promise<ApiResult<{ ok: boolean; url: string }>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const formData = new FormData();
    formData.append("file", blob, "image.webp");
    formData.append("variant", variant);

    const res = await fetch(`${webUrl}/api/electron/upload`, {
      method: "POST",
      headers: { ...authHeaders() },
      body: formData,
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; url: string };
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

/** Verifica la API con el mismo origen CORS que usa la app de escritorio. */
export async function pingWeb(): Promise<ApiResult<null>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(`${webUrl}/api/electron/solicitudes?tipo=cotizaciones`, {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      return ok(res.status, latencyMs, null);
    }

    return fail(res.status, latencyMs, `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

export interface HeartbeatPayload {
  version?: string;
  instanceId?: string;
  hostname?: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  lastSeenAt?: string;
}

export async function sendHeartbeat(
  payload: HeartbeatPayload,
): Promise<ApiResult<HeartbeatResponse>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(`${webUrl}/api/electron/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as HeartbeatResponse;
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

export type SolicitudesTipo = "cotizaciones" | "soporte";

export interface SolicitudRemota {
  id: string;
  [key: string]: unknown;
}

export interface SolicitudesResponse {
  ok: boolean;
  count: number;
  solicitudes: SolicitudRemota[];
}

export interface ActualizarEstadoPayload {
  estado: string;
}

export async function actualizarEstadoSolicitud(
  id: string,
  estado: string,
): Promise<ApiResult<{ ok: boolean }>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(`${webUrl}/api/electron/solicitudes/${id}/estado`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ estado } satisfies ActualizarEstadoPayload),
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as { ok: boolean };
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

export async function fetchSolicitudes(
  tipo: SolicitudesTipo,
): Promise<ApiResult<SolicitudesResponse>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(`${webUrl}/api/electron/solicitudes?tipo=${tipo}`, {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as SolicitudesResponse;
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

export interface RegistroOrdenTrabajoPayload {
  clientName: string;
  clientPhone?: string;
  clientRut?: string;
  clientEmail?: string;
  clientComuna?: string;
  clientAddress?: string;
  message?: string;
  shipping?: Record<string, unknown> | null;
  products: Array<{
    productId?: string;
    name?: string;
    quantity: number;
    unitPrice?: number;
    selectedColorId?: string | null;
    selectedColor?: string | null;
  }>;
}

export interface RegistroOrdenTrabajoResponse {
  ok: boolean;
  id: string;
  estado: string;
}

/**
 * Elimina una solicitud (cotización / OT / soporte) por su id, vía la API
 * protegida de la web (DELETE /api/electron/solicitudes/[id]).
 */
export async function eliminarSolicitud(
  id: string,
): Promise<ApiResult<{ ok: boolean }>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(
      `${webUrl}/api/electron/solicitudes/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { ...authHeaders() },
      },
    );
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as { ok: boolean };
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

/** Elimina un producto del catálogo (DELETE en /api/electron/productos/[id]). */
export async function eliminarProducto(
  id: string,
): Promise<ApiResult<{ ok: boolean }>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(
      `${webUrl}/api/electron/productos/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { ...authHeaders() },
      },
    );
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as { ok: boolean };
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

export interface ProductoUpdate {
  name?: string;
  modelo?: string;
  serie?: string;
  catalog?: string;
  catalogo?: string;
  category?: string;
  categoria?: string;
  capacity?: string;
  description?: string;
  longDescription?: string;
  specs?: string[];
  features?: string[];
  technicalDetails?: { label: string; value: string }[];
  disabledColors?: string[];
  isOutOfStock?: boolean;
  disableColors?: boolean;
  isPromo?: boolean;
  promoTag?: string;
  promoDescription?: string;
  isFeatured?: boolean;
  listPrice?: number;
  price?: number;
  precio?: number;
  images?: {
    carousel: { src: string; focus?: { x: number; y: number } };
    product: { src: string; focus?: { x: number; y: number } };
  }[];
}

/** Crea un producto nuevo en Firestore (POST en /api/electron/productos). */
export async function crearProducto(
  campos: ProductoUpdate & { id?: string },
): Promise<ApiResult<{ ok: boolean; id: string }>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(`${webUrl}/api/electron/productos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(campos),
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; id: string };
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

/** Actualiza campos editables de un producto (PATCH en /api/electron/productos/[id]). */
export async function actualizarProducto(
  id: string,
  campos: ProductoUpdate,
): Promise<ApiResult<{ ok: boolean }>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(
      `${webUrl}/api/electron/productos/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(campos),
      },
    );
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as { ok: boolean };
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

/**
 * Edita una cotización EXISTENTE en el mismo documento (PATCH en
 * /api/electron/solicitudes/[id]) para no crear una copia duplicada.
 */
export async function actualizarCotizacionSolicitud(
  id: string,
  payload: Omit<RegistroOrdenTrabajoPayload, "id"> &
    Partial<{ estado: string; enOT: boolean }>,
): Promise<ApiResult<RegistroOrdenTrabajoResponse>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(
      `${webUrl}/api/electron/solicitudes/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      },
    );
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as RegistroOrdenTrabajoResponse;
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

export interface CatalogDefinition {
  id: string;
  label: string;
}

export interface CategoryDefinition {
  id: string;
  catalogId: string;
  label: string;
  description: string;
}

export interface CatalogConfigData {
  catalogs: CatalogDefinition[];
  categories: CategoryDefinition[];
}

export const defaultCatalogConfig: CatalogConfigData = {
  catalogs: [
    { id: "cafe", label: "Tostadores de café" },
    { id: "frutos", label: "Frutos secos y trigo" },
  ],
  categories: [
    {
      id: "cafe",
      catalogId: "cafe",
      label: "Línea TLC",
      description: "Tostadores de café de especialidad y producción artesanal.",
    },
    {
      id: "comercial",
      catalogId: "frutos",
      label: "Tostadores comerciales",
      description: "Maní, avellanas, trigo, almendras, semillas y más. Gas o leña.",
    },
    {
      id: "industrial",
      catalogId: "frutos",
      label: "Tostadores industriales",
      description: "Alta capacidad para plantas de producción continua.",
    },
    {
      id: "procesamiento",
      catalogId: "frutos",
      label: "Equipos de procesamiento",
      description: "Partidores, molinos y descascaradores.",
    },
  ],
};

/** Trae la configuración de catálogos y categorías desde FicaTostadoresWEB. */
export async function fetchCatalogConfig(): Promise<ApiResult<CatalogConfigData>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(`${webUrl}/api/catalog-config`, {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as CatalogConfigData;
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}

/**
 * Registra una cotización como orden de trabajo (OT) en Firestore, vía la API
 * protegida de la web. La OT queda con estado "aprobada_ot" y enOT: true.
 */
export async function registrarOrdenTrabajo(
  payload: RegistroOrdenTrabajoPayload,
): Promise<ApiResult<RegistroOrdenTrabajoResponse>> {
  const { webUrl } = getConfig();

  if (!webUrl) {
    return fail(null, 0, "VITE_WEB_API_URL no definida en .env");
  }

  const started = performance.now();

  try {
    const res = await fetch(`${webUrl}/api/electron/solicitudes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      const data = (await res.json()) as RegistroOrdenTrabajoResponse;
      return ok(res.status, latencyMs, data);
    }

    const apiError = await readApiError(res);
    return fail(res.status, latencyMs, apiError ?? `HTTP ${res.status}`);
  } catch (error) {
    return fail(
      null,
      Math.round(performance.now() - started),
      `Sin respuesta (${errorMessage(error)})`,
    );
  }
}
