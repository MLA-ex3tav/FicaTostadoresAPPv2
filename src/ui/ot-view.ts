import type { SolicitudRemota } from "../lib/web-api";
import {
  getSolicitudDate,
  subscribeSolicitudes,
  eliminarSolicitudRemota,
  avanzarEstadoSolicitud,
  type SolicitudesState,
} from "../services/solicitudes";
import { obtenerOrdenTrabajoPdf, descargarPdf } from "../services/cotizacion-pdf";
import { openPdfViewer } from "./pdf-viewer";
import { showToast } from "./toast";
import { renderIcon } from "./icons";
import { openContextMenu, type ContextMenuItem } from "./context-menu";
import { openNuevaCotizacion } from "./nueva-cotizacion";
import { showConfirmDialog } from "./confirm-dialog";
import { compartirPdf } from "./pdf-share";
import { conLoader } from "./loader";

const OT_ESTADO_LABELS: Record<string, string> = {
  aprobada_ot: "Por iniciar",
  en_produccion: "En producción",
  terminada: "Terminada",
  entregada: "Entregada",
};

const OT_ESTADOS = ["aprobada_ot", "en_produccion", "terminada", "entregada"];

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function formatFecha(date: Date | null): string {
  if (!date) return "—";

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function resumirProductos(item: SolicitudRemota): string {
  if (!Array.isArray(item.products) || item.products.length === 0) {
    return "—";
  }

  const names = item.products
    .map((product) =>
      product && typeof product === "object" && "name" in product
        ? String((product as { name?: unknown }).name ?? "")
        : "",
    )
    .filter((name) => name.trim());

  if (names.length === 0) {
    return `${item.products.length} producto(s)`;
  }

  const extra = names.length - 1;
  return extra > 0 ? `${names[0]} +${extra}` : names[0];
}

function otEstadoLabel(item: SolicitudRemota): string {
  const estado = typeof item.estado === "string" && item.estado.trim()
    ? item.estado
    : "aprobada_ot";

  return OT_ESTADO_LABELS[estado] ?? estado;
}

function otEstadoClass(estado: string): string {
  switch (estado) {
    case "entregada":
      return "status-pill status-pill--done";
    case "en_produccion":
    case "terminada":
      return "status-pill status-pill--progress";
    default:
      return "status-pill status-pill--pending";
  }
}

function otEstadoPill(item: SolicitudRemota): string {
  const estado = typeof item.estado === "string" && item.estado.trim()
    ? item.estado
    : "aprobada_ot";

  return `<span class="${otEstadoClass(estado)}"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(otEstadoLabel(item))}</span>`;
}

function siguienteEstado(estado: string): string | null {
  switch (estado) {
    case "aprobada_ot":
      return "en_produccion";
    case "en_produccion":
      return "terminada";
    case "terminada":
      return "entregada";
    default:
      return null;
  }
}

function siguienteLabel(estado: string): string {
  switch (estado) {
    case "aprobada_ot":
      return "Iniciar producción";
    case "en_produccion":
      return "Marcar terminada";
    case "terminada":
      return "Marcar entregada";
    default:
      return "—";
  }
}

function renderStats(containerId: string, stats: Array<{ label: string; value: string; tone?: string }>): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = stats
    .map(
      (card) => `
      <article class="stat-card">
        <div class="stat-card__label">${card.label}</div>
        <div class="stat-card__value${card.tone ? ` stat-card__value--${card.tone}` : ""}">${card.value}</div>
      </article>`,
    )
    .join("");
}

function renderOT(state: SolicitudesState): void {
  const items = state.cotizaciones.filter((item) => {
    const estado = typeof item.estado === "string" && item.estado.trim()
      ? item.estado
      : "";
    return OT_ESTADOS.includes(estado);
  });

  const porIniciar = items.filter((item) => item.estado === "aprobada_ot");
  const enProduccion = items.filter((item) => item.estado === "en_produccion");
  const terminadas = items.filter((item) => item.estado === "terminada");
  const entregadas = items.filter((item) => item.estado === "entregada");

  renderStats("ot-stats", [
    { label: "Por iniciar", value: String(porIniciar.length), tone: "warning" },
    { label: "En producción", value: String(enProduccion.length), tone: "info" },
    { label: "Terminadas", value: String(terminadas.length), tone: "accent" },
    { label: "Entregadas", value: String(entregadas.length), tone: "success" },
  ]);

  const panel = document.getElementById("ot-list");
  if (!panel) return;

  if (items.length === 0) {
    if (state.loading) {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
          <h2 class="empty-state__title">Cargando órdenes…</h2>
          <p class="empty-state__text">Consultando la web.</p>
        </div>`;
    } else {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
          <h2 class="empty-state__title">Sin órdenes de trabajo</h2>
          <p class="empty-state__text">Aprueba cotizaciones desde la sección Cotizaciones para generar órdenes de trabajo.</p>
        </div>`;
    }
    return;
  }

  const rows = items
    .map((item) => {
      const cliente = escapeHtml(item.clientName ?? "Sin nombre");
      const contacto = escapeHtml(item.clientPhone ?? item.clientEmail ?? "—");
      const estado = typeof item.estado === "string" && item.estado.trim()
        ? item.estado
        : "aprobada_ot";
      const next = siguienteEstado(estado);

      const acciones = next
        ? `<div class="action-cell">
            <button class="btn btn--stage btn--sm" data-avanzar="${escapeHtml(item.id)}" data-next="${next}">
              ${renderIcon("play", { size: 14 })} ${siguienteLabel(estado)}
            </button>
          </div>`
        : `<span class="cell-muted">—</span>`;

      return `<tr data-id="${escapeHtml(item.id)}">
        <td><strong>${cliente}</strong><br><span class="cell-muted">${contacto}</span></td>
        <td>${escapeHtml(resumirProductos(item))}</td>
        <td>${formatFecha(getSolicitudDate(item))}</td>
        <td>${otEstadoPill(item)}</td>
        <td>${acciones}</td>
      </tr>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Productos</th><th>Fecha</th><th>Etapa</th><th>Acciones</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const abrirPdf = async (id: string): Promise<void> => {
    const item = items.find((ot) => ot.id === id);
    if (!item) return;

    try {
      const { pdf, cacheado } = await obtenerOrdenTrabajoPdf(item);
      openPdfViewer(pdf);
      if (!cacheado) {
        showToast({
          title: "PDF de OT Generado",
          message: `Se ha abierto ${pdf.fileName} para visualización.`,
          tone: "success",
          icon: "fileText",
          actions: [
            { label: "Descargar PDF", onClick: () => descargarPdf(pdf), primary: true },
          ],
        });
      }
    } catch (error) {
      console.error("Error al generar PDF de OT:", error);
      showToast({
        title: "Error al generar PDF",
        message: "No se pudo generar la Orden de Trabajo en PDF.",
        tone: "error",
      });
    }
  };

  const avanzar = async (id: string, nextEstado: string): Promise<void> => {
    const result = await avanzarEstadoSolicitud(id, nextEstado);
    if (!result.ok) {
      showToast({
        title: "Error al actualizar OT",
        message: result.error ?? "Ocurrió un error al cambiar la etapa de producción.",
        tone: "error",
      });
    } else if (result.queued) {
      showToast({
        title: "Cambio guardado sin conexión",
        message: "La nueva etapa se enviará automáticamente cuando se recupere la conexión.",
        tone: "info",
      });
    } else {
      showToast({
        title: "Etapa de OT Actualizada",
        message: "La orden de trabajo fue avanzada exitosamente.",
        tone: "success",
      });
    }
  };

  const eliminar = async (id: string, nombreCliente: string): Promise<void> => {
    const confirmado = await showConfirmDialog({
      title: "¿Eliminar orden de trabajo?",
      message: `Se eliminará permanentemente la OT de ${nombreCliente}. Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!confirmado) return;

    const result = await conLoader(
      eliminarSolicitudRemota(id),
      "Eliminando…",
    );
    if (result.ok) {
      showToast({
        title: "OT eliminada",
        message: "La orden de trabajo fue eliminada.",
        tone: "success",
      });
    } else {
      showToast({
        title: "Error al eliminar OT",
        message: result.error ?? "No se pudo eliminar la orden de trabajo.",
        tone: "error",
      });
    }
  };

  panel.querySelectorAll<HTMLButtonElement>('[data-avanzar]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.avanzar;
      const nextEstado = btn.dataset.next;
      if (!id || !nextEstado) return;

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "Actualizando…";

      try {
        await avanzar(id, nextEstado);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText ?? "—";
      }
    });
  });

  panel.querySelectorAll<HTMLTableRowElement>("tbody tr[data-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      const id = row.dataset.id;
      if (!id) return;

      const target = event.target as HTMLElement;
      if (target.closest("button")) return;

      event.preventDefault();
      event.stopPropagation();
      void abrirPdf(id);
    });

    row.addEventListener("contextmenu", (event) => {
      const id = row.dataset.id;
      if (!id) return;

      const item = items.find((ot) => ot.id === id);
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();

      const estado = typeof item.estado === "string" && item.estado.trim()
        ? item.estado
        : "aprobada_ot";
      const next = siguienteEstado(estado);
      const menuItems: ContextMenuItem[] = [];

      if (next) {
        menuItems.push({
          label: siguienteLabel(estado),
          icon: "play",
          onClick: () => void avanzar(id, next),
        });
      }

      if (estado === "aprobada_ot") {
        menuItems.push({
          label: "Editar OT",
          icon: "fileText",
          onClick: () => openNuevaCotizacion(item),
        });
      }

      menuItems.push({
        label: "Compartir PDF",
        icon: "fileText",
        onClick: () => {
          void (async () => {
            const { pdf } = await obtenerOrdenTrabajoPdf(item);
            await compartirPdf(item, pdf);
          })().catch(() => {
            showToast({
              title: "Error al generar PDF",
              message: "No se pudo generar la Orden de Trabajo en PDF.",
              tone: "error",
            });
          });
        },
      });

      menuItems.push({ separator: true });

      menuItems.push({
        label: "Eliminar OT",
        icon: "close",
        danger: true,
        onClick: () => void eliminar(id, String(item.clientName ?? "este cliente")),
      });

      openContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
    });
  });
}

export function initOTView(): void {
  subscribeSolicitudes((state) => {
    renderOT(state);
  });
}
