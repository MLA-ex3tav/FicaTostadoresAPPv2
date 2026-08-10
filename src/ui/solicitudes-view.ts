import { actualizarEstadoSolicitud, type SolicitudRemota } from "../lib/web-api";
import {
  getSolicitudDate,
  isSolicitudPendiente,
  refreshSolicitudes,
  subscribeSolicitudes,
  aprobarCotizacion,
  rechazarCotizacion,
  eliminarSolicitudRemota,
  type SolicitudesState,
} from "../services/solicitudes";
import { generarCotizacionPdf, obtenerCotizacionPdf, descargarPdf } from "../services/cotizacion-pdf";
import { openPdfViewer } from "./pdf-viewer";
import { showToast } from "./toast";
import { renderIcon } from "./icons";
import { setNavBadge } from "./sidebar";
import { openContextMenu, type ContextMenuItem } from "./context-menu";
import { openNuevaCotizacion } from "./nueva-cotizacion";
import { showConfirmDialog } from "./confirm-dialog";
import { compartirPdf } from "./pdf-share";
import { conLoader } from "./loader";

/* ── Utilidades ── */

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => entities[char] ?? char,
  );
}

function formatFecha(date: Date | null): string {
  if (!date) return "—";

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isToday(date: Date | null): boolean {
  if (!date) return false;

  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isThisWeek(date: Date | null): boolean {
  if (!date) return false;

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const time = date.getTime();

  return time <= now && now - time <= weekMs;
}

function isThisMonth(date: Date | null): boolean {
  if (!date) return false;

  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

async function confirmarYEliminar(id: string, descripcion: string): Promise<void> {
  const confirmado = await showConfirmDialog({
    title: "¿Eliminar solicitud?",
    message: `Se eliminará permanentemente ${descripcion}. Esta acción no se puede deshacer.`,
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
      title: "Solicitud eliminada",
      message: "La solicitud fue eliminada.",
      tone: "success",
    });
  } else {
    showToast({
      title: "Error al eliminar",
      message: result.error ?? "No se pudo eliminar la solicitud.",
      tone: "error",
    });
  }
}

/* ── Stats y estados ── */

interface StatCard {
  label: string;
  value: string;
  tone?: "accent" | "success" | "warning" | "info";
  hint?: string;
}

function renderStats(containerId: string, cards: StatCard[]): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = cards
    .map(
      (card) => `
      <article class="stat-card">
        <div class="stat-card__label">${card.label}</div>
        <div class="stat-card__value${card.tone ? ` stat-card__value--${card.tone}` : ""}">${card.value}</div>
        ${card.hint ? `<div class="stat-card__hint">${card.hint}</div>` : ""}
      </article>`,
    )
    .join("");
}

const ESTADO_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_revision: "En revisión",
  en_cotizacion: "En cotización",
  aprobada_ot: "Aprobada (OT)",
  rechazada: "Rechazada",
  completada: "Completada",
  abierta: "Abierta",
  en_curso: "En curso",
  resuelta: "Resuelta",
  cerrada: "Cerrada",
};

function estadoPillClass(estado: string): string {
  switch (estado) {
    case "aprobada_ot":
    case "completada":
    case "resuelta":
    case "cerrada":
      return "status-pill status-pill--done";
    case "en_cotizacion":
    case "en_curso":
      return "status-pill status-pill--progress";
    case "rechazada":
      return "status-pill status-pill--error";
    default:
      return "status-pill status-pill--pending";
  }
}

function getEstado(item: SolicitudRemota, fallback: string): string {
  return typeof item.estado === "string" && item.estado.trim()
    ? item.estado
    : fallback;
}

function estadoPill(item: SolicitudRemota, fallback: string): string {
  const estado = getEstado(item, fallback);
  const label =
    typeof item.cotizacionEstadoLabel === "string" &&
    item.cotizacionEstadoLabel.trim()
      ? item.cotizacionEstadoLabel
      : (ESTADO_LABELS[estado] ?? estado);

  return `<span class="${estadoPillClass(estado)}"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

/* ── Estados de panel (cargando / error / vacío) ── */

function renderPanelMessage(
  containerId: string,
  title: string,
  text: string,
): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">
        ${renderIcon("information", { size: 26 })}
      </div>
      <h2 class="empty-state__title">${escapeHtml(title)}</h2>
      <p class="empty-state__text">${escapeHtml(text)}</p>
    </div>
  `;
}

/* ── Cotizaciones ── */

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

function renderCotizaciones(state: SolicitudesState): void {
  const items = state.cotizaciones;

  const pendientes = items.filter(isSolicitudPendiente);
  const hoy = items.filter((item) => isToday(getSolicitudDate(item)));
  const semana = items.filter((item) => isThisWeek(getSolicitudDate(item)));
  const aprobadas = items.filter((item) =>
    ["aprobada_ot", "completada"].includes(getEstado(item, "")),
  );

  renderStats("cotizaciones-stats", [
    {
      label: "Pendientes",
      value: String(pendientes.length),
      tone: "accent",
      hint: state.loading ? "Actualizando…" : undefined,
    },
    { label: "Hoy", value: String(hoy.length), tone: "info" },
    { label: "Esta semana", value: String(semana.length) },
    { label: "Aprobadas", value: String(aprobadas.length), tone: "success" },
  ]);

  setNavBadge("cotizaciones", pendientes.length);

  if (items.length === 0) {
    if (state.error) {
      renderPanelMessage(
        "cotizaciones-list",
        "No se pudieron cargar las cotizaciones",
        `${state.error} · Revisa la sección Conexiones.`,
      );
    } else if (state.loading) {
      renderPanelMessage(
        "cotizaciones-list",
        "Cargando cotizaciones…",
        "Consultando la web.",
      );
    } else {
      renderPanelMessage(
        "cotizaciones-list",
        "Sin cotizaciones por ahora",
        "Cuando llegue una solicitud desde la web aparecerá aquí automáticamente.",
      );
    }
    return;
  }

  const rows = items
    .map((item) => {
      const cliente = escapeHtml(item.clientName ?? "Sin nombre");
      const contacto = escapeHtml(item.clientPhone ?? item.clientEmail ?? "—");
      const estado = getEstado(item, "pendiente");
      const esEditable = !["aprobada_ot", "rechazada", "completada"].includes(estado);

      const acciones = esEditable
        ? `<div class="action-cell">
            <button class="btn btn--success btn--sm" data-action="aprobar" data-id="${escapeHtml(item.id)}">
              ${renderIcon("check", { size: 14 })} Aprobar
            </button>
            <button class="btn btn--danger btn--sm" data-action="rechazar" data-id="${escapeHtml(item.id)}">
              ${renderIcon("close", { size: 14 })} Rechazar
            </button>
          </div>`
        : `<span class="cell-muted">—</span>`;

      return `<tr data-id="${escapeHtml(item.id)}">
        <td><strong>${cliente}</strong><br><span class="cell-muted">${contacto}</span></td>
        <td>${escapeHtml(resumirProductos(item))}</td>
        <td>${formatFecha(getSolicitudDate(item))}</td>
        <td>${estadoPill(item, "pendiente")}</td>
        <td>${acciones}</td>
      </tr>`;
    })
    .join("");

  const panel = document.getElementById("cotizaciones-list");
  if (!panel) return;

  panel.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Productos</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${state.error ? `<div class="conn-updated">Última actualización con errores: ${escapeHtml(state.error)}</div>` : ""}
  `;

  const abrirPdf = async (id: string): Promise<void> => {
    const item = state.cotizaciones.find((cotizacion) => cotizacion.id === id);
    if (!item) return;

    try {
      const { pdf, cacheado } = await obtenerCotizacionPdf(item);
      openPdfViewer(pdf);
      if (!cacheado) {
        showToast({
          title: "PDF Generado",
          message: `Se ha abierto ${pdf.fileName} para visualización.`,
          tone: "success",
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
        message: "No se pudo crear el documento.",
        tone: "error",
      });
    }
  };

  const aprobar = async (id: string): Promise<void> => {
    const result = await aprobarCotizacion(id);
    if (!result.ok) {
      showToast({
        title: "Error al aprobar",
        message: result.error ?? "No se pudo aprobar la cotización.",
        tone: "error",
      });
      return;
    }

    showToast({
      title: "Cotización Aprobada",
      message: "La solicitud fue aprobada y movida a Órdenes de Trabajo.",
      tone: "success",
    });

    const item = state.cotizaciones.find((cotizacion) => cotizacion.id === id);
    if (item) {
      try {
        const pdf = await generarCotizacionPdf(item);
        openPdfViewer(pdf);
        showToast({
          title: "PDF de Orden de Trabajo Generado",
          message: `Documento ${pdf.fileName} listo.`,
          tone: "success",
          icon: "fileText",
          actions: [
            { label: "Ver PDF", onClick: () => openPdfViewer(pdf), primary: true },
            { label: "Descargar", onClick: () => descargarPdf(pdf) },
          ],
        });
      } catch (error) {
        console.error("No se pudo generar el PDF de la OT", error);
        showToast({
          title: "Cotización aprobada",
          message: "La cotización fue aprobada, pero no se pudo generar el PDF automáticamente.",
          tone: "warning",
        });
      }
    }
  };

  const rechazar = async (id: string): Promise<void> => {
    const result = await rechazarCotizacion(id);
    if (!result.ok) {
      showToast({
        title: "Error al rechazar",
        message: result.error ?? "No se pudo rechazar la cotización.",
        tone: "error",
      });
    } else {
      showToast({
        title: "Cotización Rechazada",
        message: "La solicitud fue marcada como rechazada.",
        tone: "info",
      });
    }
  };

  panel.querySelectorAll<HTMLButtonElement>('[data-action="aprobar"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;

      btn.disabled = true;
      btn.textContent = "Aprobando…";
      try {
        await aprobar(id);
      } finally {
        btn.disabled = false;
        btn.textContent = "Aprobar";
      }
    });
  });

  panel.querySelectorAll<HTMLButtonElement>('[data-action="rechazar"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;

      btn.disabled = true;
      btn.textContent = "Rechazando…";
      try {
        await rechazar(id);
      } finally {
        btn.disabled = false;
        btn.textContent = "Rechazar";
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

      const item = state.cotizaciones.find((cotizacion) => cotizacion.id === id);
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();

      const estado = getEstado(item, "pendiente");
      const esEditable = !["aprobada_ot", "rechazada", "completada"].includes(estado);

      const menuItems: ContextMenuItem[] = [];

      if (esEditable) {
        menuItems.push({
          label: "Editar cotización",
          icon: "fileText",
          onClick: () => openNuevaCotizacion(item),
        });
        menuItems.push({
          label: "Aprobar (mover a OT)",
          icon: "check",
          onClick: () => void aprobar(id),
        });
        menuItems.push({
          label: "Rechazar",
          icon: "close",
          onClick: () => void rechazar(id),
        });
      }

      menuItems.push({
        label: "Compartir PDF",
        icon: "fileText",
        onClick: () => {
          void (async () => {
            const { pdf } = await obtenerCotizacionPdf(item);
            await compartirPdf(item, pdf);
          })().catch(() => {
            showToast({
              title: "Error al generar PDF",
              message: "No se pudo crear el documento.",
              tone: "error",
            });
          });
        },
      });

      menuItems.push({ separator: true });

      menuItems.push({
        label: "Eliminar cotización",
        icon: "close",
        danger: true,
        onClick: () =>
          void confirmarYEliminar(id, `la cotización de ${item.clientName ?? "este cliente"}.`),
      });

      openContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
    });
  });
}

/* ── Soporte técnico ── */

function renderSoporte(state: SolicitudesState): void {
  const items = state.soporte;

  const abiertas = items.filter(
    (item) => getEstado(item, "abierta") === "abierta",
  );
  const enCurso = items.filter(
    (item) => getEstado(item, "") === "en_curso",
  );
  const resueltas = items.filter((item) =>
    ["resuelta", "cerrada"].includes(getEstado(item, "")),
  );
  const esteMes = items.filter((item) => isThisMonth(getSolicitudDate(item)));

  renderStats("soporte-stats", [
    { label: "Abiertas", value: String(abiertas.length), tone: "warning" },
    { label: "En curso", value: String(enCurso.length), tone: "info" },
    { label: "Resueltas", value: String(resueltas.length), tone: "success" },
    { label: "Este mes", value: String(esteMes.length) },
  ]);

  setNavBadge("soporte", abiertas.length);

  if (items.length === 0) {
    if (state.error) {
      renderPanelMessage(
        "soporte-list",
        "No se pudieron cargar las solicitudes",
        `${state.error} · Revisa la sección Conexiones.`,
      );
    } else if (state.loading) {
      renderPanelMessage(
        "soporte-list",
        "Cargando solicitudes…",
        "Consultando la web.",
      );
    } else {
      renderPanelMessage(
        "soporte-list",
        "Sin solicitudes de soporte",
        "Cuando llegue una solicitud de servicio técnico desde la web aparecerá aquí.",
      );
    }
    return;
  }

  const rows = items
    .map((item) => {
      const cliente = escapeHtml(item.clientName ?? "Sin nombre");
      const contacto = escapeHtml(item.clientPhone ?? item.clientEmail ?? "—");
      const equipo = escapeHtml(item.equipmentModel ?? "—");
      const categoria = escapeHtml(item.issueCategory ?? "—");
      const estado = getEstado(item, "abierta");

      const acciones = estado === "abierta"
        ? `<div class="action-cell">
            <button class="btn btn--info btn--sm" data-soporte-action="en_curso" data-id="${escapeHtml(item.id)}">
              ${renderIcon("headphones", { size: 14 })} Atender
            </button>
            <button class="btn btn--success btn--sm" data-soporte-action="resuelta" data-id="${escapeHtml(item.id)}">
              ${renderIcon("check", { size: 14 })} Resolver
            </button>
          </div>`
        : estado === "en_curso"
          ? `<div class="action-cell">
              <button class="btn btn--success btn--sm" data-soporte-action="resuelta" data-id="${escapeHtml(item.id)}">
                ${renderIcon("check", { size: 14 })} Resolver
              </button>
            </div>`
          : `<span class="cell-muted">—</span>`;

      return `<tr data-id="${escapeHtml(item.id)}">
        <td><strong>${cliente}</strong><br><span class="cell-muted">${contacto}</span></td>
        <td>${equipo}</td>
        <td>${categoria}</td>
        <td>${formatFecha(getSolicitudDate(item))}</td>
        <td>${estadoPill(item, "abierta")}</td>
        <td>${acciones}</td>
      </tr>`;
    })
    .join("");

  const panel = document.getElementById("soporte-list");
  if (!panel) return;

  panel.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Equipo</th><th>Categoría</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const cambiarEstado = async (id: string, nextState: string): Promise<void> => {
    const result = await actualizarEstadoSolicitud(id, nextState);
    if (result.ok) {
      await refreshSolicitudes();
      showToast({
        title: "Ticket de Soporte Actualizado",
        message: `La solicitud cambió a estado: ${ESTADO_LABELS[nextState] ?? nextState}`,
        tone: "success",
      });
    } else {
      showToast({
        title: "Error al actualizar ticket",
        message: result.error ?? "No se pudo actualizar la solicitud.",
        tone: "error",
      });
    }
  };

  panel.querySelectorAll<HTMLButtonElement>('[data-soporte-action]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const nextState = btn.dataset.soporteAction;
      if (!id || !nextState) return;

      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.textContent = "Actualizando…";

      try {
        await cambiarEstado(id, nextState);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    });
  });

  panel.querySelectorAll<HTMLTableRowElement>("tbody tr[data-id]").forEach((row) => {
    row.addEventListener("contextmenu", (event) => {
      const id = row.dataset.id;
      if (!id) return;

      const item = state.soporte.find((solicitud) => solicitud.id === id);
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();

      const estado = getEstado(item, "abierta");
      const menuItems: ContextMenuItem[] = [];

      if (estado === "abierta") {
        menuItems.push({
          label: "Marcar como en curso",
          icon: "play",
          onClick: () => void cambiarEstado(id, "en_curso"),
        });
        menuItems.push({
          label: "Marcar como resuelta",
          icon: "check",
          onClick: () => void cambiarEstado(id, "resuelta"),
        });
      } else if (estado === "en_curso") {
        menuItems.push({
          label: "Marcar como resuelta",
          icon: "check",
          onClick: () => void cambiarEstado(id, "resuelta"),
        });
      }

      menuItems.push({ separator: true });

      menuItems.push({
        label: "Eliminar solicitud",
        icon: "close",
        danger: true,
        onClick: () =>
          void confirmarYEliminar(id, `el ticket de soporte de ${item.clientName ?? "este cliente"}.`),
      });

      openContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
    });
  });
}

/* ── Init ── */

export function initSolicitudesViews(): void {
  subscribeSolicitudes((state) => {
    renderCotizaciones(state);
    renderSoporte(state);
  });
}
