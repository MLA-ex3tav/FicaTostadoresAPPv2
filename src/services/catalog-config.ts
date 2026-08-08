import { doc, getDoc } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import { fetchCatalogConfig, defaultCatalogConfig, type CatalogConfigData } from "../lib/web-api";

const CATALOGO_CONFIG_COLLECTION = "catalogo_config";
const CATALOGO_CONFIG_DEFAULT_DOC_ID = "default";

/**
 * Trae la configuración de catálogos y categorías directamente desde Firestore
 * (documento `catalogo_config/default`, la misma fuente que usa la web).
 * Si Firestore no responde, intenta la API de la web y, como último recurso,
 * usa la configuración por defecto.
 */
export async function loadCatalogConfig(): Promise<CatalogConfigData> {
  try {
    const snapshot = await getDoc(
      doc(getDb(), CATALOGO_CONFIG_COLLECTION, CATALOGO_CONFIG_DEFAULT_DOC_ID),
    );

    if (snapshot.exists()) {
      const data = snapshot.data();
      if (data && Array.isArray(data.catalogs) && Array.isArray(data.categories)) {
        return {
          catalogs: data.catalogs,
          categories: data.categories,
        } satisfies CatalogConfigData;
      }
    }
  } catch (error) {
    console.warn("[catalog-config] No se pudo leer catalogo_config desde Firestore", error);
  }

  try {
    const result = await fetchCatalogConfig();
    if (result.ok && result.data) {
      return result.data;
    }
  } catch (error) {
    console.warn("[catalog-config] No se pudo leer catalog-config desde la web", error);
  }

  return defaultCatalogConfig;
}
