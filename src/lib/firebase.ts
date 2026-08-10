import { getApps, initializeApp } from "firebase/app";
import {
  enableMultiTabIndexedDbPersistence,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import { getConfig } from "./config";

let db: Firestore | null = null;
let persistenceStarted = false;

/**
 * Firestore con el SDK cliente (misma config pública que la web).
 * Se usa para lecturas públicas (catálogo). Las solicitudes se leen
 * vía API de la web porque las reglas exigen rol staff.
 */
export function getDb(): Firestore {
  if (!db) {
    const { firebase } = getConfig();
    const app = getApps()[0] ?? initializeApp(firebase);
    db = getFirestore(app);
  }

  return db;
}

/**
 * Activa la persistencia offline (IndexedDB). Permite que el catálogo siga
 * funcionando sin internet. Debe llamarse ANTES de la primera operación
 * contra Firestore; se invoca al arrancar en main.ts.
 */
export async function ensureFirestorePersistence(): Promise<void> {
  if (persistenceStarted) return;
  persistenceStarted = true;

  try {
    await enableMultiTabIndexedDbPersistence(getDb());
  } catch (error) {
    console.warn(
      "[firebase] Persistencia offline no disponible (el catálogo requerirá red):",
      error,
    );
  }
}
