import { getNetworkState, onNetworkChange } from "../lib/network";
import { onQueueCount } from "../lib/offline-queue";

/**
 * Banner persistente que indica el estado de conexión y los cambios
 * pendientes por sincronizar.
 */
let element: HTMLElement | null = null;
let pending = 0;

function ensureElement(): HTMLElement {
  if (!element) {
    element = document.createElement("div");
    element.id = "fica-offline-banner";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    document.body.appendChild(element);
  }
  return element;
}

function render(): void {
  const banner = ensureElement();
  const network = getNetworkState();

  if (network === "offline") {
    banner.className = "fica-banner fica-banner--offline is-visible";
    banner.textContent =
      pending > 0
        ? `Sin conexión · ${pending} cambio(s) guardado(s) localmente. Se enviarán al reconectar.`
        : "Sin conexión · Los cambios se guardan localmente y se enviarán al reconectar.";
  } else if (pending > 0) {
    banner.className = "fica-banner fica-banner--pending is-visible";
    banner.textContent = `Sincronizando ${pending} cambio(s) guardado(s)…`;
  } else {
    banner.className = "fica-banner";
    banner.textContent = "";
  }
}

export function initOfflineBanner(): void {
  ensureElement();
  onNetworkChange(render);
  onQueueCount((count) => {
    pending = count;
    render();
  });
  render();
}
