import { openContextMenu, type ContextMenuItem } from "./context-menu";
import { openNuevaCotizacion } from "./nueva-cotizacion";
import { refreshSolicitudes } from "../services/solicitudes";
import { navigateTo } from "./sidebar";
import { getTheme, toggleTheme } from "./theme";

const INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, [contenteditable='true']";

let initialized = false;

/**
 * Menú contextual general: click derecho en áreas vacías de la app permite
 * actualizar datos, crear una cotización, navegar entre vistas o cambiar de tema.
 * Las filas de documentos y controles interactivos conservan sus propios menús.
 */
export function initGlobalContextMenu(): void {
  if (initialized) return;
  initialized = true;

  document.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.closest(INTERACTIVE_SELECTOR)) return;
    if (target.closest("[data-id]")) return;

    event.preventDefault();

    const dark = getTheme() === "dark";
    const items: ContextMenuItem[] = [
      {
        label: "Actualizar datos",
        icon: "refresh",
        onClick: () => void refreshSolicitudes(),
      },
      {
        label: "Nueva cotización",
        icon: "add",
        onClick: () => openNuevaCotizacion(),
      },
      { separator: true },
      {
        label: "Ir a Cotizaciones",
        icon: "clipboardList",
        onClick: () => navigateTo("cotizaciones"),
      },
      {
        label: "Ir a Órdenes de Trabajo",
        icon: "play",
        onClick: () => navigateTo("ot"),
      },
      { separator: true },
      {
        label: dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
        icon: dark ? "sun" : "moon",
        onClick: () => toggleTheme(),
      },
    ];

    openContextMenu({ x: event.clientX, y: event.clientY, items });
  });
}