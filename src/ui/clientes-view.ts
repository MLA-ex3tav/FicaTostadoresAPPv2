import { getSolicitudDate, subscribeSolicitudes, type SolicitudesState } from "../services/solicitudes";
import { renderIcon } from "./icons";
import { openContextMenu, type ContextMenuItem } from "./context-menu";

interface ClienteInfo {
  key: string;
  name: string;
  phone: string;
  email: string;
  total: number;
  ultimaFecha: Date | null;
}

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

/** Normaliza un teléfono: conserva dígitos y el "+" inicial. */
function normalizePhone(phone: unknown): string {
  const raw = typeof phone === "string" ? phone.trim() : "";
  return raw.replace(/[^0-9+]/g, "");
}

/**
 * Clave de identidad del cliente. Prioriza teléfono, luego e-mail, y solo usa
 * el nombre como último recurso (cuando no hay dato de contacto).
 */
function clienteKey(item: { [key: string]: unknown }): string {
  const phone = normalizePhone(item.clientPhone);
  if (phone) return `tel:${phone}`;
  const email = typeof item.clientEmail === "string" ? item.clientEmail.trim().toLowerCase() : "";
  if (email) return `email:${email}`;
  const name = typeof item.clientName === "string" ? item.clientName.trim().toLowerCase() : "";
  return `nom:${name}`;
}

function buildClientes(state: SolicitudesState): ClienteInfo[] {
  const map = new Map<string, ClienteInfo>();

  const allItems = state.cotizaciones.concat(state.soporte);

  for (const item of allItems) {
    const name = (typeof item.clientName === "string" ? item.clientName : "").trim();
    if (!name) continue;

    const key = clienteKey(item);
    const existing = map.get(key);

    const fecha = getSolicitudDate(item);

    if (existing) {
      existing.total++;
      if (fecha && (!existing.ultimaFecha || fecha > existing.ultimaFecha)) {
        existing.ultimaFecha = fecha;
      }
    } else {
      map.set(key, {
        key,
        name,
        phone: typeof item.clientPhone === "string" ? item.clientPhone : "",
        email: typeof item.clientEmail === "string" ? item.clientEmail : "",
        total: 1,
        ultimaFecha: fecha,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function formatFecha(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function formatPrecio(valor: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(valor);
}

const HISTORIAL_ESTADOS: Record<string, string> = {
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

function historialEstadoPill(estado: unknown): string {
  const key = typeof estado === "string" && estado.trim() ? estado : "pendiente";
  const done = ["aprobada_ot", "completada", "resuelta", "cerrada"].includes(key);
  const error = key === "rechazada";
  const progress = ["en_cotizacion", "en_curso"].includes(key);

  const cls = done
    ? "status-pill status-pill--done"
    : error
      ? "status-pill status-pill--error"
      : progress
        ? "status-pill status-pill--progress"
        : "status-pill status-pill--pending";

  return `<span class="${cls}"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(HISTORIAL_ESTADOS[key] ?? key)}</span>`;
}

function renderClientes(state: SolicitudesState): void {
  const clientes = buildClientes(state);

  const panel = document.getElementById("clientes-list");
  if (!panel) return;

  if (clientes.length === 0) {
    if (state.loading) {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
          <h2 class="empty-state__title">Cargando clientes…</h2>
          <p class="empty-state__text">Consultando la web.</p>
        </div>`;
    } else {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
          <h2 class="empty-state__title">Sin clientes registrados</h2>
          <p class="empty-state__text">Los clientes aparecerán automáticamente cuando lleguen solicitudes desde la web.</p>
        </div>`;
    }
    return;
  }

  const rows = clientes
    .map((c) => {
      const contacto = [c.phone, c.email].filter(Boolean).join(" · ") || "—";
      const reincidencia = c.total > 1
        ? `<span class="status-pill status-pill--progress"><span class="status-pill__dot" aria-hidden="true"></span>${c.total} solicitudes</span>`
        : `<span class="status-pill status-pill--pending"><span class="status-pill__dot" aria-hidden="true"></span>1 solicitud</span>`;

      return `<tr data-cliente-key="${escapeHtml(c.key)}">
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(contacto)}</td>
        <td>${reincidencia}</td>
        <td>${formatFecha(c.ultimaFecha)}</td>
      </tr>`;
    })
    .join("");

  panel.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Contacto</th><th>Actividad</th><th>Última solicitud</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const searchInput = document.getElementById("clientes-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.disabled = false;
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.toLowerCase();
      panel.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
        const texto = row.textContent?.toLowerCase() ?? "";
        row.style.display = texto.includes(term) ? "" : "none";
      });
    });
  }

  panel.querySelectorAll<HTMLTableRowElement>("tbody tr[data-cliente-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.clienteKey;
      if (!key) return;
      openHistorialCliente(key, state);
    });

    row.addEventListener("contextmenu", (event) => {
      const key = row.dataset.clienteKey;
      if (!key) return;

      event.preventDefault();
      event.stopPropagation();

      const menuItems: ContextMenuItem[] = [
        {
          label: "Ver historial del cliente",
          icon: "history",
          onClick: () => openHistorialCliente(key, state),
        },
      ];

      openContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
    });
  });
}

function openHistorialCliente(key: string, state: SolicitudesState): void {
  const items = state.cotizaciones.concat(state.soporte).filter((item) => {
    return clienteKey(item) === key;
  });

  const nombre = (() => {
    const first = items[0];
    return typeof first?.clientName === "string" && first.clientName.trim()
      ? first.clientName.trim()
      : "Cliente";
  })();

  const contacto = (() => {
    const first = items[0];
    if (!first) return "—";
    return [first.clientPhone, first.clientEmail].filter(Boolean).join(" · ") || "—";
  })();

  const overlay = document.createElement("div");
  overlay.className = "cliente-historial";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Historial de ${nombre}`);

  const rows = items
    .map((item) => {
      const productos = Array.isArray(item.products) ? item.products : [];
      const resumen = productos
        .map((product) => {
          if (!product || typeof product !== "object") return "";
          const rec = product as Record<string, unknown>;
          const pname = String(
            rec.name ?? rec.modelo ?? rec.productId ?? "Producto",
          );
          const qty = Math.max(1, Number(rec.quantity ?? 1) || 1);
          return `${escapeHtml(pname)} ×${qty}`;
        })
        .filter(Boolean)
        .join(" · ");

      const total = productos.reduce((acc, product) => {
        if (!product || typeof product !== "object") return acc;
        const rec = product as Record<string, unknown>;
        const qty = Math.max(1, Number(rec.quantity ?? 1) || 1);
        const unit = Number(rec.unitPrice ?? rec.price ?? rec.listPrice ?? 0) || 0;
        return acc + qty * unit;
      }, 0);

      return `
        <article class="cliente-historial__item">
          <div class="cliente-historial__item-head">
            <span class="cliente-historial__item-id">${escapeHtml(item.id)}</span>
            ${historialEstadoPill(item.estado)}
            <span class="cliente-historial__item-fecha">${formatFecha(getSolicitudDate(item))}</span>
          </div>
          <div class="cliente-historial__item-products">${resumen || "Sin productos registrados"}</div>
          ${total > 0 ? `<div class="cliente-historial__item-total">${formatPrecio(total)}</div>` : ""}
        </article>`;
    })
    .join("");

  overlay.innerHTML = `
    <div class="cliente-historial__panel">
      <header class="cliente-historial__header">
        <div class="cliente-historial__icon" aria-hidden="true">${renderIcon("history", { size: 22 })}</div>
        <div>
          <h3 class="cliente-historial__title">Historial de ${escapeHtml(nombre)}</h3>
          <p class="cliente-historial__subtitle">${items.length} solicitud(es) · ${escapeHtml(contacto)}</p>
        </div>
        <button type="button" class="cliente-historial__close" data-close aria-label="Cerrar" title="Cerrar">
          ${renderIcon("close", { size: 22 })}
        </button>
      </header>
      <div class="cliente-historial__list">
        ${
          rows
            ? rows
            : `<div class="empty-state">
                <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
                <h2 class="empty-state__title">Sin solicitudes</h2>
                <p class="empty-state__text">Este cliente aún no tiene cotizaciones ni solicitudes registradas.</p>
              </div>`
        }
      </div>
    </div>
  `;

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", handleKey);
  };
  const handleKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  overlay.querySelector("[data-close]")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", handleKey);

  document.body.appendChild(overlay);
}

export function initClientesView(): void {
  subscribeSolicitudes((state) => {
    renderClientes(state);
  });
}
