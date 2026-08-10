import { hydrateInstanceId } from "./lib/config";
import { ensureFirestorePersistence } from "./lib/firebase";
import { getNetworkState, initNetwork, onNetworkChange } from "./lib/network";
import { flushQueue } from "./lib/offline-queue";
import { hydrateSecret } from "./lib/secure-store";
import { invoke } from "./lib/runtime";
import { startHeartbeat } from "./services/heartbeat";
import { startCatalogoLive, syncAllPreciosToServer } from "./services/catalog";
import { refreshSolicitudes, startSolicitudesPolling } from "./services/solicitudes";
import { registerQueueExecutors, postFlushSync, syncNow } from "./services/queue-executors";
import { checkAppUpdates } from "./services/updater";
import { initClientesView } from "./ui/clientes-view";
import { initConexionesView, runConexiones } from "./ui/conexiones-view";
import { initGlobalContextMenu } from "./ui/global-context-menu";
import { initHistorialView } from "./ui/historial-view";
import { mountIcons } from "./ui/icons";
import { initKeyboardShortcuts } from "./ui/keyboard-shortcuts";
import { initNuevaCotizacion } from "./ui/nueva-cotizacion";
import { initOfflineBanner } from "./ui/offline-banner";
import { initNotifications } from "./services/notifications";
import { initOTView } from "./ui/ot-view";
import { initProductosView } from "./ui/productos-view";
import { initSidebar, navigateTo, onNavigate } from "./ui/sidebar";
import { initSolicitudesViews } from "./ui/solicitudes-view";
import { initTheme } from "./ui/theme";
import { showToast } from "./ui/toast";
import { handleViewChange, initViews } from "./ui/views";

async function initApp(): Promise<void> {
  // Persistencia offline de Firestore: debe habilitarse antes de la primera
  // operación para que el catálogo funcione sin internet.
  await ensureFirestorePersistence();

  // Secreto desde el llavero del sistema (si está configurado).
  void hydrateSecret();

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
  initKeyboardShortcuts();
  initOfflineBanner();

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

  // Sistema de seguridad: conectividad + cola offline
  initNetwork();
  registerQueueExecutors();

  onNetworkChange((networkState) => {
    if (networkState === "online") {
      void flushQueue().then(() => void postFlushSync());
    }
  });

  window.setInterval(() => {
    if (getNetworkState() === "online") {
      void flushQueue().then(() => void postFlushSync());
    }
  }, 60_000);

  // Acción "Sincronizar ahora" desde el icono de la bandeja del sistema.
  void (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen("sync-now", () => {
        void syncNow();
      });
    } catch {
      /* navegador (dev sin Tauri) */
    }
  })();

  // Reenvía operaciones pendientes de una sesión anterior al arrancar.
  void flushQueue().then(() => void postFlushSync());

  // Servicios en segundo plano
  startHeartbeat();
  startSolicitudesPolling();
  startCatalogoLive();
  void syncAllPreciosToServer();
  void runConexiones();

  // Notificaciones de escritorio para nuevas solicitudes.
  void initNotifications();

  // Detección de cierres forzosos + identidad estable (SQLite).
  void (async () => {
    try {
      const health = await invoke<{
        wasCleanExit: boolean;
        instanceId: string;
        secretInKeyring: boolean;
      }>("startup_health");

      hydrateInstanceId(health.instanceId);

      if (!health.wasCleanExit) {
        showToast({
          title: "Cierre inesperado detectado",
          message:
            "La aplicación no se cerró correctamente la última vez. Tus datos locales están a salvo.",
          tone: "warning",
          icon: "information",
          durationMs: 8000,
        });
      }
    } catch {
      /* navegador (dev sin Tauri): sin detección de crash */
    }
  })();

  // Comprobar actualizaciones en GitHub Releases
  setTimeout(() => {
    void checkAppUpdates(false);
  }, 2500);
}

window.addEventListener("DOMContentLoaded", () => {
  void initApp();
});
