import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
} from "firebase/firestore";
import { getDb } from "../lib/firebase";
import { getConfig } from "../lib/config";
import { actualizarProducto, eliminarProducto } from "../lib/web-api";

export interface ProductoCatalogo {
  id: string;
  name?: string;
  modelo?: string;
  catalog?: string;
  catalogo?: string;
  category?: string;
  categoria?: string;
  capacity?: string;
  listPrice?: number;
  price?: number;
  precio?: number;
  [key: string]: unknown;
}

/**
 * El precio vive en Firestore (campos listPrice/price/precio), que es la fuente
 * de verdad compartida con la app móvil y la web. Esta app solo mantiene una
 * cola local de escrituras pendientes (offline) que se reenvía al servidor.
 */
const LOCAL_PRICES_KEY = "fica-product-prices";

let catalogo: ProductoCatalogo[] = [];
let unsubscribeSnapshot: (() => void) | null = null;

type CatalogoListener = (productos: ProductoCatalogo[]) => void;
const listeners = new Set<CatalogoListener>();

function emit(): void {
  const snapshot = getCatalogo();
  listeners.forEach((listener) => listener(snapshot));
}

function readLocalPrices(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOCAL_PRICES_KEY) ?? "{}");
    if (!value || typeof value !== "object") return {};

    return Object.fromEntries(
      Object.entries(value).filter(
        ([, price]) => typeof price === "number" && Number.isFinite(price) && price >= 0,
      ),
    );
  } catch {
    return {};
  }
}

function writeLocalPrices(prices: Record<string, number>): void {
  localStorage.setItem(LOCAL_PRICES_KEY, JSON.stringify(prices));
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function getCatalogo(): ProductoCatalogo[] {
  return [...catalogo];
}

/** Precio vigente del catálogo en tiempo real (listPrice > price > precio). */
export function getPrecioLocal(producto: ProductoCatalogo): number {
  return (
    numberValue(producto.listPrice, producto.price, producto.precio, producto.unitPrice) ?? 0
  );
}

function syncPriceToServer(productId: string, price: number): void {
  const { webUrl, appSecret } = getConfig();

  if (!webUrl || !appSecret) {
    return;
  }

  void fetch(`${webUrl}/api/electron/productos/${encodeURIComponent(productId)}/precio`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appSecret}`,
    },
    body: JSON.stringify({ price }),
  })
    .then((res) => {
      if (res.ok) {
        const prices = readLocalPrices();
        if (prices[productId] !== undefined) {
          delete prices[productId];
          writeLocalPrices(prices);
        }
      }
    })
    .catch((error) => {
      console.warn("[catalog] No se pudo sincronizar el precio con el servidor", error);
    });
}

/**
 * Guarda un precio y lo sincroniza con Firestore (vía la API protegida), para
 * que quede disponible en tiempo real en cualquier otra instalación.
 */
export function setPrecioLocal(productId: string, price: number): void {
  const clean = Math.max(0, Number.isFinite(price) ? price : 0);

  const prices = readLocalPrices();
  prices[productId] = clean;
  writeLocalPrices(prices);

  const product = catalogo.find((entry) => entry.id === productId);
  if (product) {
    product.listPrice = clean;
    product.price = clean;
    product.precio = clean;
  }
  emit();

  syncPriceToServer(productId, clean);
}

export interface SyncResult {
  ok: boolean;
  total: number;
  failed: { id: string; reason: string }[];
}

/** Reenvía al servidor los precios pendientes (editados sin conexión). */
export async function syncAllPreciosToServer(): Promise<SyncResult> {
  const { webUrl, appSecret } = getConfig();
  const prices = readLocalPrices();
  const ids = Object.keys(prices);

  if (!webUrl || !appSecret) {
    return {
      ok: false,
      total: ids.length,
      failed: ids.map((id) => ({
        id,
        reason: "webUrl o appSecret no configurados (revisa .env)",
      })),
    };
  }

  const failed: SyncResult["failed"] = [];

  for (const id of ids) {
    try {
      const res = await fetch(
        `${webUrl}/api/electron/productos/${encodeURIComponent(id)}/precio`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${appSecret}`,
          },
          body: JSON.stringify({ price: prices[id] }),
        },
      );

      if (res.ok) {
        const pending = readLocalPrices();
        if (pending[id] !== undefined) {
          delete pending[id];
          writeLocalPrices(pending);
        }
      } else {
        failed.push({ id, reason: `HTTP ${res.status}` });
      }
    } catch (error) {
      failed.push({
        id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: failed.length === 0, total: ids.length, failed };
}

/**
 * Elimina un producto del catálogo en Firestore (vía la API protegida de la web).
 * Optimista: si la API confirma, se descarta del estado local al instante.
 */
export async function eliminarProductoCatalogo(
  id: string,
): Promise<{ ok: boolean; error: string | null }> {
  const result = await eliminarProducto(id);

  if (result.ok) {
    const wasPresent = catalogo.some((product) => product.id === id);
    catalogo = catalogo.filter((product) => product.id !== id);

    if (wasPresent) {
      emit();
    }

    return { ok: true, error: null };
  }

  return {
    ok: false,
    error: result.error ?? "No se pudo eliminar el producto.",
  };
}

import type { ProductoUpdate } from "../lib/web-api";

export interface ProductoUpdateLocal extends ProductoUpdate {}

/**
 * Actualiza campos editables de un producto en Firestore (vía la API protegida
 * de la web) y refleja el cambio en el catálogo local en tiempo real.
 */
export async function actualizarProductoCatalogo(
  id: string,
  campos: ProductoUpdateLocal,
): Promise<{ ok: boolean; error: string | null }> {
  const result = await actualizarProducto(id, campos);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "No se pudo actualizar el producto.",
    };
  }

  const product = catalogo.find((entry) => entry.id === id);
  if (product) {
    for (const [key, value] of Object.entries(campos)) {
      product[key] = value;
    }
    emit();
  }

  return { ok: true, error: null };
}

export function findProducto(productId: unknown, name: unknown): ProductoCatalogo | null {  const id = typeof productId === "string" ? productId : "";
  const productName = typeof name === "string" ? name.trim().toLowerCase() : "";

  return (
    catalogo.find((product) => product.id === id) ??
    catalogo.find((product) => product.name?.trim().toLowerCase() === productName) ??
    null
  );
}

export async function loadCatalogo(): Promise<ProductoCatalogo[]> {
  const snapshot = await getDocs(query(collection(getDb(), "productos"), limit(100)));
  catalogo = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ProductoCatalogo));
  emit();
  return getCatalogo();
}

/**
 * Mantiene el catálogo en tiempo real con Firestore onSnapshot (una única
 * suscripción para toda la app). Retorna una función para cancelar.
 */
export function startCatalogoLive(): () => void {
  if (unsubscribeSnapshot) {
    return unsubscribeSnapshot;
  }

  const source = query(collection(getDb(), "productos"), limit(100));

  unsubscribeSnapshot = onSnapshot(
    source,
    (snapshot) => {
      catalogo = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as ProductoCatalogo,
      );
      emit();
    },
    (error) => {
      console.warn("[catalog] No se pudo suscribir al catálogo en tiempo real", error);
    },
  );

  return unsubscribeSnapshot;
}

export function subscribeCatalogo(listener: CatalogoListener): () => void {
  listeners.add(listener);
  listener(getCatalogo());

  return () => {
    listeners.delete(listener);
  };
}
