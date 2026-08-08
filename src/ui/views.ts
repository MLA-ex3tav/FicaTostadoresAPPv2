import type { ViewId } from "./sidebar";
import { renderIcon } from "./icons";

interface StatCard {
  label: string;
  value: string;
  tone?: "accent" | "success" | "warning" | "info";
  hint?: string;
}

interface EmptyState {
  title: string;
  text: string;
  features: string[];
}

function statValueClass(tone?: StatCard["tone"]): string {
  if (!tone) return "stat-card__value";
  return `stat-card__value stat-card__value--${tone}`;
}

function renderStats(containerId: string, cards: StatCard[]): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = cards
    .map(
      (card) => `
      <article class="stat-card">
        <div class="stat-card__label">${card.label}</div>
        <div class="${statValueClass(card.tone)}">${card.value}</div>
        ${card.hint ? `<div class="stat-card__hint">${card.hint}</div>` : ""}
      </article>`
    )
    .join("");
}

function renderEmptyState(containerId: string, state: EmptyState): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  const features = state.features
    .map((item) => `<li>${item}</li>`)
    .join("");

  el.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">
        ${renderIcon("information", { size: 26 })}
      </div>
      <h2 class="empty-state__title">${state.title}</h2>
      <p class="empty-state__text">${state.text}</p>
      <ul class="feature-list">${features}</ul>
      <span class="empty-state__badge">
        <span class="empty-state__badge-dot" aria-hidden="true"></span>
        Próximo: conexión Firebase / datos locales
      </span>
    </div>
  `;
}

function renderPlaceholderTable(
  containerId: string,
  headers: string[],
  rows: string[][]
): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`
    )
    .join("");

  el.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

// Nota: cotizaciones y soporte se renderizan en vivo desde src/ui/solicitudes-view.ts,
// y conexiones desde src/ui/conexiones-view.ts. Aquí quedan solo los placeholders.
const VIEW_CONTENT: Partial<
  Record<
    ViewId,
    {
      statsId?: string;
      stats?: StatCard[];
      panelId: string;
      empty: EmptyState;
      demoRows?: { headers: string[]; rows: string[][] };
    }
  >
> = {
  ot: {
    statsId: "ot-stats",
    stats: [
      { label: "En producción", value: "—", tone: "info" },
      { label: "Por iniciar", value: "—", tone: "warning" },
      { label: "Entregadas", value: "—", tone: "success" },
      { label: "Retrasadas", value: "—", tone: "accent" },
    ],
    panelId: "ot-list",
    empty: {
      title: "Órdenes de trabajo vacías",
      text: "Las OT se crean a partir de cotizaciones aprobadas y permiten seguir el avance de fabricación.",
      features: [
        "Kanban / lista de producción por etapa",
        "Fechas estimadas y responsables",
        "Cierre de OT y paso a historial",
      ],
    },
  },
  historial: {
    panelId: "historial-list",
    empty: {
      title: "Historial vacío",
      text: "Cuando se cierren cotizaciones u OT, aparecerán aquí para consulta y reimpresión de PDFs.",
      features: [
        "Filtro por cliente, fecha y tipo de documento",
        "Reabrir o duplicar cotizaciones",
        "Acceso a PDFs generados",
      ],
    },
    demoRows: {
      headers: ["N°", "Cliente", "Tipo", "Fecha", "Estado"],
      rows: [
        ["—", "Ejemplo demo", "Cotización", "—", '<span class="status-pill status-pill--done">Cerrada</span>'],
        ["—", "Ejemplo demo", "OT", "—", '<span class="status-pill status-pill--done">Entregada</span>'],
      ],
    },
  },
  clientes: {
    panelId: "clientes-list",
    empty: {
      title: "Sin clientes cargados",
      text: "El directorio se arma automáticamente con los datos de las cotizaciones y compras.",
      features: [
        "Ficha de contacto y empresa",
        "Historial de solicitudes y máquinas compradas",
        "Indicadores de reincidencia",
      ],
    },
  },
  productos: {
    panelId: "productos-root",
    empty: {
      title: "Catálogo pendiente de sincronizar",
      text: "Los productos se sincronizarán con el catálogo de la web (Firestore / Blob).",
      features: [
        "Tostadoras, accesorios y variantes de color",
        "Precios y configuración de cotización",
        "Sincronización con FicaTostadoresWEB",
      ],
    },
  },
};

export function initViews(): void {
  (Object.keys(VIEW_CONTENT) as ViewId[]).forEach((viewId) => {
    const config = VIEW_CONTENT[viewId];

    if (!config) return;

    if (config.statsId && config.stats) {
      renderStats(config.statsId, config.stats);
    }

    if (config.demoRows) {
      renderPlaceholderTable(
        config.panelId,
        config.demoRows.headers,
        config.demoRows.rows
      );
    } else {
      renderEmptyState(config.panelId, config.empty);
    }
  });
}

export function handleViewChange(_viewId: ViewId): void {
  // Punto de extensión: listeners Firebase / SQLite por sección
}
