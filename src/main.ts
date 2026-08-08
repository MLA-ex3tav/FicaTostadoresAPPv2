import { startHeartbeat } from "./services/heartbeat";
import { startCatalogoLive, syncAllPreciosToServer } from "./services/catalog";
import { refreshSolicitudes, startSolicitudesPolling } from "./services/solicitudes";
import { checkAppUpdates } from "./services/updater";
import { initClientesView } from "./ui/clientes-view";
import { initConexionesView, runConexiones } from "./ui/conexiones-view";
import { initGlobalContextMenu } from "./ui/global-context-menu";
import { initHistorialView } from "./ui/historial-view";
import { mountIcons } from "./ui/icons";
import { initNuevaCotizacion } from "./ui/nueva-cotizacion";
import { initOTView } from "./ui/ot-view";
import { initProductosView } from "./ui/productos-view";
import { initSidebar, navigateTo, onNavigate } from "./ui/sidebar";
import { initSolicitudesViews } from "./ui/solicitudes-view";
import { initTheme } from "./ui/theme";
import { handleViewChange, initViews } from "./ui/views";

function initApp(): void {
  initTheme();
  mountIcons();
  initSidebar();
  initViews();
  initConexionesView();
  initSolicitudesViews();
  initNuevaCotizacion();
  initOTView();
  initHistorialView();
  initClientesView();
  initProductosView();
  initGlobalContextMenu();

  onNavigate((viewId) => {
    handleViewChange(viewId);

    if (viewId === "conexiones") {
      void runConexiones();
    }

    if (viewId === "cotizaciones" || viewId === "soporte" || viewId === "ot") {
      void refreshSolicitudes();
    }
  });

  navigateTo("cotizaciones");

  // Servicios en segundo plano
  startHeartbeat();
  startSolicitudesPolling();
  startCatalogoLive();
  void syncAllPreciosToServer();
  void runConexiones();

  // Comprobar actualizaciones en GitHub Releases
  setTimeout(() => {
    void checkAppUpdates(false);
  }, 2500);
}

window.addEventListener("DOMContentLoaded", () => {
  initApp();
});
