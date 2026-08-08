import { getApps, initializeApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getConfig } from "./config";

let db: Firestore | null = null;

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
