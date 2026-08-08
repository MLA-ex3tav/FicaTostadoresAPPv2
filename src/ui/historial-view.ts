import type { SolicitudRemota } from "../lib/web-api";
import {
  getSolicitudDate,
  subscribeSolicitudes,
  type SolicitudesState,
} from "../services/solicitudes";
import { obtenerCotizacionPdf, obtenerOrdenTrabajoPdf, descargarPdf } from "../services/cotizacion-pdf";
import { openPdfViewer } from "./pdf-viewer";
import { showToast } from "./toast";
import { renderIcon } from "./icons";
import { compartirPdf } from "./pdf-share";
import { openContextMenu, type ContextMenuItem } from "./context-menu";

const HISTORIAL_ESTADOS = ["completada", "rechazada", "cerrada", "entregada", "resuelta"];

const ESTADO_LABELS: Record<string, string> = {
  completada: "Completada",
  rechazada: "Rechazada",
  cerrada: "Cerrada",
  entregada: "Entregada",
  resuelta: "Resuelta",
};

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
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function resumirProductos(item: SolicitudRemota): string {
  if (!Array.isArray(item.products) || item.products.length === 0) return "—";
  const names = item.products
    .map((p) => (p && typeof p === "object" && "name" in p ? String((p as { name?: unknown }).name ?? "") : ""))
    .filter((n) => n.trim());
  if (names.length === 0) return `${item.products.length} producto(s)`;
  const extra = names.length - 1;
  return extra > 0 ? `${names[0]} +${extra}` : names[0];
}

function estadoPill(item: SolicitudRemota): string {
  const estado = typeof item.estado === "string" && item.estado.trim() ? item.estado : "completada";
  const label = ESTADO_LABELS[estado] ?? estado;
  const cssClass = estado === "rechazada" ? "status-pill status-pill--error" : "status-pill status-pill--done";
  return `<span class="${cssClass}"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function tipoLabel(item: SolicitudRemota): string {
  const estado = typeof item.estado === "string" && item.estado.trim() ? item.estado : "";
  if (estado === "resuelta" || estado === "cerrada") return "Soporte";
  return "OT";
}

function renderHistorial(state: SolicitudesState): void {
  const items = state.cotizaciones.concat(state.soporte).filter((item) => {
    const estado = typeof item.estado === "string" && item.estado.trim() ? item.estado : "";
    return HISTORIAL_ESTADOS.includes(estado);
  });

  const panel = document.getElementById("historial-list");
  if (!panel) return;

  if (items.length === 0) {
    if (state.loading) {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
          <h2 class="empty-state__title">Cargando historial…</h2>
          <p class="empty-state__text">Consultando la web.</p>
        </div>`;
    } else {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
          <h2 class="empty-state__title">Historial vacío</h2>
          <p class="empty-state__text">Cuando se cierren cotizaciones u OT, aparecerán aquí para consulta.</p>
        </div>`;
    }
    return;
  }

  const rows = items
    .map((item) => {
      const cliente = escapeHtml(item.clientName ?? "Sin nombre");
      const contacto = escapeHtml(item.clientPhone ?? item.clientEmail ?? "—");

      return `<tr data-id="${escapeHtml(item.id)}">
        <td><strong>${cliente}</strong><br><span class="cell-muted">${contacto}</span></td>
        <td>${escapeHtml(resumirProductos(item))}</td>
        <td>${escapeHtml(tipoLabel(item))}</td>
        <td>${formatFecha(getSolicitudDate(item))}</td>
        <td>${estadoPill(item)}</td>
        <td><span class="cell-muted">—</span></td>
      </tr>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Productos</th><th>Tipo</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const abrirPdf = async (id: string): Promise<void> => {
    const item = items.find((h) => h.id === id);
    if (!item) return;

    try {
      const esOT = tipoLabel(item) === "OT" || ["aprobada_ot", "en_produccion", "terminada", "entregada"].includes(String(item.estado ?? ""));
      const { pdf, cacheado } = esOT
        ? await obtenerOrdenTrabajoPdf(item)
        : await obtenerCotizacionPdf(item);
      openPdfViewer(pdf);
      if (!cacheado) {
        showToast({
          title: "PDF del Historial",
          message: `Se ha abierto ${pdf.fileName} para visualización.`,
          tone: "info",
          icon: "fileText",
          actions: [
            { label: "Descargar PDF", onClick: () => descargarPdf(pdf), primary: true },
          ],
        });
      }
    } catch (error) {
      console.error("Error al generar PDF:", error);
      showToast({
        title: "Error al generar PDF",
        message: "No se pudo recuperar el PDF del historial.",
        tone: "error",
      });
    }
  };

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
      const item = items.find((h) => h.id === id);
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();

      const menuItems: ContextMenuItem[] = [
        {
          label: "Compartir PDF",
          icon: "fileText",
          onClick: () => {
            void (async () => {
              const esOT = tipoLabel(item) === "OT" || ["aprobada_ot", "en_produccion", "terminada", "entregada"].includes(String(item.estado ?? ""));
              const { pdf } = esOT
                ? await obtenerOrdenTrabajoPdf(item)
                : await obtenerCotizacionPdf(item);
              await compartirPdf(item, pdf);
            })().catch(() => {
              showToast({
                title: "Error al generar PDF",
                message: "No se pudo recuperar el PDF del historial.",
                tone: "error",
              });
            });
          },
        },
      ];

      openContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
    });
  });

  const searchInput = document.getElementById("historial-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.disabled = false;
    const clearBtn = document.querySelector<HTMLButtonElement>('[data-clear="historial-search"]');
    const filtrar = (): void => {
      const term = searchInput!.value.toLowerCase();
      panel.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
        const texto = row.textContent?.toLowerCase() ?? "";
        row.style.display = texto.includes(term) ? "" : "none";
      });
      clearBtn?.classList.toggle("is-visible", searchInput!.value.length > 0);
    };
    searchInput.addEventListener("input", filtrar);
    clearBtn?.addEventListener("click", () => {
      searchInput!.value = "";
      filtrar();
      searchInput!.focus();
    });
  }
}

export function initHistorialView(): void {
  subscribeSolicitudes((state) => {
    renderHistorial(state);
  });
}
