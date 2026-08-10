import { check, type Update } from "@tauri-apps/plugin-updater";
import { showToast } from "../ui/toast";

export const APP_VERSION = "0.2.2";

/**
 * Comprueba en GitHub Releases si hay una actualización disponible usando el
 * plugin nativo de Tauri. Si hay una, ofrece descargar e instalar automáticamente.
 */
export async function checkAppUpdates(manual = false): Promise<void> {
  try {
    const update = await check();

    if (!update) {
      if (manual) {
        showToast({
          title: "Aplicación actualizada",
          message: `Estás en la versión ${APP_VERSION}. No hay actualizaciones disponibles.`,
          tone: "success",
          icon: "check",
        });
      }
      return;
    }

    const changelog = update.body?.trim()
      ? `\n\n${update.body.trim().slice(0, 400)}`
      : "";

    showToast({
      title: `Actualización ${update.version} disponible`,
      message: `Nueva versión de Fica Tostadores.${changelog}`,
      tone: "warning",
      durationMs: 20000,
      actions: [
        {
          label: "Descargar e instalar",
          primary: true,
          onClick: () => void descargarEInstalar(update),
        },
      ],
    });
  } catch (error) {
    console.error("[updater] Error al buscar actualizaciones:", error);
    if (manual) {
      showToast({
        title: "No se pudo buscar actualizaciones",
        message: "Verifica tu conexión a internet e inténtalo de nuevo.",
        tone: "error",
      });
    }
  }
}

let downloading = false;

async function descargarEInstalar(update: Update): Promise<void> {
  if (downloading) return;
  downloading = true;

  showToast({
    title: `Descargando ${update.version}…`,
    message: "La descarga se realizará en segundo plano. No cierres la aplicación.",
    tone: "info",
    icon: "refresh",
    durationMs: 0,
  });

  try {
    let downloaded = 0;
    let contentLength = 0;

    await update.download((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }
    });

    // Simplemente avisamos; install() ejecuta el instalador y reinicia la app.
    showToast({
      title: "Descarga completada",
      message:
        contentLength > 0
          ? `${(downloaded / 1024 / 1024).toFixed(1)} MB descargados. Instalando…`
          : "Instalando la nueva versión…",
      tone: "info",
      durationMs: 4000,
    });

    await update.install();
  } catch (error) {
    console.error("[updater] Error al descargar/instalar:", error);
    showToast({
      title: "Error al actualizar",
      message: "No se pudo completar la descarga o la instalación.",
      tone: "error",
    });
  } finally {
    downloading = false;
  }
}
