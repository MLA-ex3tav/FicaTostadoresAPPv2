import { openNuevaCotizacion } from "./nueva-cotizacion";
import { refreshSolicitudes } from "../services/solicitudes";
import { navigateTo } from "./sidebar";
import { checkAppUpdates } from "../services/updater";

let initialized = false;

/**
 * Atajos de teclado globales de la app:
 *  - Ctrl/Cmd + N  → Nueva cotización
 *  - Ctrl/Cmd + R  → Refrescar datos (solicitudes)
 *  - Ctrl/Cmd + U  → Buscar actualizaciones
 *  - Ctrl/Cmd + 1..7 → Navegar a sección
 *  - Escape         → se maneja por cada modal (aquí solo como respaldo)
 *
 * Los atajos se ignoran cuando el foco está en un input/textarea/select para
 * no interferir con la escritura.
 */
export function initKeyboardShortcuts(): void {
  if (initialized) return;
  initialized = true;

  const VIEW_ORDER = [
    "cotizaciones",
    "ot",
    "historial",
    "clientes",
    "productos",
    "soporte",
    "conexiones",
  ] as const;

  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const target = event.target as HTMLElement | null;
    const isTyping = Boolean(
      target?.closest("input, textarea, select, [contenteditable='true']"),
    );

    if (mod && event.key.toLowerCase() === "n") {
      event.preventDefault();
      openNuevaCotizacion();
      return;
    }

    if (mod && event.key.toLowerCase() === "r") {
      event.preventDefault();
      void refreshSolicitudes();
      return;
    }

    if (mod && event.key.toLowerCase() === "u") {
      event.preventDefault();
      void checkAppUpdates(true);
      return;
    }

    if (mod && /^[1-7]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      const viewId = VIEW_ORDER[index];
      if (viewId) {
        event.preventDefault();
        navigateTo(viewId);
      }
      return;
    }

    // Sin modificador: solo atajos que no rompan la escritura.
    if (isTyping) return;

    if (event.key.toLowerCase() === "n" && !event.shiftKey) {
      event.preventDefault();
      openNuevaCotizacion();
    }
  });
}
