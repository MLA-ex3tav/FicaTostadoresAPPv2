import {
  actualizarProductoCatalogo,
  crearProductoCatalogo,
  getCatalogo,
} from "./catalog";
import type { ProductoUpdateLocal } from "./catalog";

/**
 * Importador de productos desde el JSON de "Listado de precios" generado por
 * OmniPress. Replica la lógica de FicaTostadoresWEB/lib/products/excel-import.ts
 * y de app/api/admin/products/import: sanitiza filas, calcula catálogo/categoría
 * con mapSeriesGroup, crea productos nuevos y actualiza el precio/serie de los
 * existentes (los detalles técnicos solo se rellenan si están vacíos).
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ImportRow {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  capacity?: unknown;
  group?: unknown;
  serie?: unknown;
  technicalDetails?: unknown;
}

export interface SanitizedRow {
  id: string;
  name: string;
  price: number | null;
  capacity: string;
  group: string;
  serie: string;
  technicalDetails: { label: string; value: string }[];
}

export interface ImportError {
  id: string;
  name: string;
  message: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  errors: ImportError[];
  failed: ImportError[];
}

export function slugifyProductId(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Igual que mapSeriesGroup de la web: calcula catalog/category desde el grupo. */
export function mapSeriesGroup(group: string, name: string): {
  catalog: string;
  category: string;
} {
  const text = `${group} ${name}`.toLowerCase();

  if (/café|cacao/.test(text)) {
    return { catalog: "cafe", category: "cafe" };
  }

  if (
    /procesador|partidor|descascarador|clasificador|molino|limpiadora|cernidor|revolvedor|confitador|grageador|horno|seleccionador|peladora/.test(
      text,
    )
  ) {
    return { catalog: "frutos", category: "procesamiento" };
  }

  if (/industrial/.test(text)) {
    return { catalog: "frutos", category: "industrial" };
  }

  return { catalog: "frutos", category: "comercial" };
}

function sanitizeText(
  value: unknown,
  maxLength: number,
  required = false,
): string | null {
  if (typeof value !== "string") {
    return required ? null : "";
  }

  const cleaned = value.trim();
  if (required && !cleaned) {
    return null;
  }

  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function sanitizeTechnicalDetails(
  value: unknown,
): { label: string; value: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const details: { label: string; value: string }[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const label = sanitizeText(record.label, 100, true);
    const detailValue = sanitizeText(record.value, 200, true);

    if (label && detailValue) {
      details.push({ label, value: detailValue });
    }
  }

  return details.slice(0, 10);
}

export function parseImportJson(body: unknown): {
  rows: SanitizedRow[];
  errors: ImportError[];
} {
  const errors: ImportError[] = [];
  const rows: SanitizedRow[] = [];

  if (!Array.isArray(body)) {
    return { rows, errors };
  }

  if (body.length > 300) {
    return { rows, errors };
  }

  for (const raw of body) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const item = raw as ImportRow;
    const rawId = typeof item.id === "string" ? item.id.trim() : "";
    const id = SLUG_PATTERN.test(rawId) ? rawId : "";
    const name = sanitizeText(item.name, 200, true) ?? "";
    const price =
      typeof item.price === "number" &&
      Number.isFinite(item.price) &&
      item.price >= 0
        ? Math.round(item.price)
        : null;
    const capacity = sanitizeText(item.capacity, 100) ?? "";
    const group = sanitizeText(item.group, 200) ?? "";
    const serie = sanitizeText(item.serie, 200) ?? "";
    const technicalDetails = sanitizeTechnicalDetails(item.technicalDetails);
    const label = name || rawId;

    if (!id || !name) {
      errors.push({
        id: id || "?",
        name: label,
        message: "Faltan ID o nombre.",
      });
      continue;
    }

    rows.push({
      id,
      name,
      price,
      capacity,
      group,
      serie,
      technicalDetails,
    });
  }

  return { rows, errors };
}

/** Cuenta cuántos se crearán y cuántos actualizarán precio, según el catálogo actual. */
export function previewImportacion(
  rows: SanitizedRow[],
): { nuevos: number; actualizan: number } {
  const ids = new Set(getCatalogo().map((product) => product.id));
  let nuevos = 0;
  let actualizan = 0;

  for (const row of rows) {
    if (ids.has(row.id)) {
      actualizan += 1;
    } else {
      nuevos += 1;
    }
  }

  return { nuevos, actualizan };
}

export async function importarProductos(
  rows: SanitizedRow[],
): Promise<ImportSummary> {
  const catalogo = getCatalogo();
  const knownIds = new Set(catalogo.map((product) => product.id));
  const summary: ImportSummary = {
    total: rows.length,
    created: 0,
    updated: 0,
    errors: [],
    failed: [],
  };

  for (const row of rows) {
    if (knownIds.has(row.id)) {
      const existing = catalogo.find((product) => product.id === row.id);
      const updates: ProductoUpdateLocal = {};

      if (row.serie) {
        updates.serie = row.serie;
      }

      if (row.price !== null) {
        updates.listPrice = row.price;
        updates.price = row.price;
        updates.precio = row.price;
      }

      const existingDetails = Array.isArray(existing?.technicalDetails)
        ? existing.technicalDetails
        : [];
      if (existingDetails.length === 0 && row.technicalDetails.length > 0) {
        updates.technicalDetails = row.technicalDetails;
      }

      if (Object.keys(updates).length === 0) {
        summary.updated += 1;
        continue;
      }

      const result = await actualizarProductoCatalogo(row.id, updates);

      if (result.ok) {
        summary.updated += 1;
      } else {
        summary.failed.push({
          id: row.id,
          name: row.name,
          message: result.error ?? "No se pudo actualizar el producto.",
        });
      }
    } else {
      const mapping = mapSeriesGroup(row.group, row.name);
      const campos: ProductoUpdateLocal & { id?: string } = {
        id: row.id,
        name: row.name,
        catalog: mapping.catalog,
        catalogo: mapping.catalog,
        category: mapping.category,
        categoria: mapping.category,
        capacity: row.capacity || undefined,
        description: row.name,
        serie: row.serie,
        technicalDetails: row.technicalDetails,
      };

      if (row.price !== null) {
        campos.listPrice = row.price;
        campos.price = row.price;
        campos.precio = row.price;
      }

      const result = await crearProductoCatalogo(campos);

      if (result.ok) {
        knownIds.add(row.id);
        summary.created += 1;
      } else {
        summary.failed.push({
          id: row.id,
          name: row.name,
          message: result.error ?? "No se pudo crear el producto.",
        });
      }
    }
  }

  return summary;
}
