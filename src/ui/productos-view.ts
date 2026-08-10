import {
  actualizarProductoCatalogo,
  crearProductoCatalogo,
  eliminarProductoCatalogo,
  getCatalogo,
  getPrecioLocal,
  loadCatalogo,
  setPrecioLocal,
  startCatalogoLive,
  subscribeCatalogo,
  syncAllPreciosToServer,
  type ProductoCatalogo,
  type ProductoUpdateLocal,
} from "../services/catalog";
import {
  importarProductos,
  parseImportJson,
  previewImportacion,
} from "../services/productos-import";
import { renderIcon } from "./icons";
import { showToast } from "./toast";
import { openContextMenu, type ContextMenuItem } from "./context-menu";
import { showConfirmDialog } from "./confirm-dialog";
import { PRODUCT_COLORS } from "../lib/product-colors";
import { loadCatalogConfig } from "../services/catalog-config";
import { procesarImagenSubida } from "./image-editor";
import {
  createSelectField,
  type SelectField,
  type SelectFieldOption,
} from "./select-field";
import { conLoader } from "./loader";

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

function formatPrecio(valor: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(valor);
}

function catalogoLabel(product: ProductoCatalogo): string {
  const raw = product.catalog ?? product.catalogo ?? product.catalogue;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return "—";
}

function matchesQuery(product: ProductoCatalogo, query: string): boolean {
  if (!query) return true;

  const haystack = [
    product.name,
    product.modelo,
    product.catalog,
    product.catalogo,
    product.categoria,
    product.category,
    product.id,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  return haystack.includes(query);
}

function productName(p: ProductoCatalogo): string {
  return p.name ?? p.modelo ?? "Sin nombre";
}

function productCatalog(p: ProductoCatalogo): string {
  return catalogoLabel(p);
}

function productCategory(p: ProductoCatalogo): string {
  return p.categoria ?? p.category ?? "—";
}

type SortKey = "nombre" | "catalogo" | "categoria";

function sortValue(p: ProductoCatalogo, key: SortKey): string {
  switch (key) {
    case "catalogo":
      return productCatalog(p);
    case "categoria":
      return productCategory(p);
    case "nombre":
    default:
      return productName(p);
  }
}

function sortProducts(
  productos: ProductoCatalogo[],
  key: SortKey | null,
  dir: "asc" | "desc",
): ProductoCatalogo[] {
  if (!key) return productos;
  const direction = dir === "asc" ? 1 : -1;
  return [...productos].sort((a, b) => {
    const cmp = sortValue(a, key).localeCompare(sortValue(b, key), "es");
    return cmp * direction;
  });
}

async function loadCategoriaOptions(): Promise<
  { id: string; label: string; catalogId: string }[]
> {
  if (categoriaOptionsCache) return categoriaOptionsCache;
  try {
    const config = await loadCatalogConfig();
    categoriaOptionsCache = config.categories.map((c) => ({
      id: c.id,
      label: c.label,
      catalogId: c.catalogId,
    }));
  } catch {
    categoriaOptionsCache = [];
  }
  return categoriaOptionsCache;
}

async function loadCatalogoOptions(): Promise<
  { id: string; label: string }[]
> {
  if (catalogoOptionsCache) return catalogoOptionsCache;
  try {
    const config = await loadCatalogConfig();
    catalogoOptionsCache = config.catalogs.map((c) => ({
      id: c.id,
      label: c.label,
    }));
  } catch {
    catalogoOptionsCache = [];
  }
  return catalogoOptionsCache;
}

let hasLoaded = false;
let syncing = false;
let searchQuery = "";
let catalogoFiltro = "";
let categoriaFiltro = "";
let sortKey: "nombre" | "catalogo" | "categoria" | null = null;
let sortDir: "asc" | "desc" = "asc";
let catalogoOptionsCache: { id: string; label: string }[] | null = null;
let categoriaOptionsCache:
  | { id: string; label: string; catalogId: string }[]
  | null = null;

function productRow(p: ProductoCatalogo): string {
  const nombre = escapeHtml(p.name ?? p.modelo ?? "Sin nombre");
  const catalogo = escapeHtml(catalogoLabel(p));
  const categoria = escapeHtml(p.categoria ?? p.category ?? "—");
  const precio = getPrecioLocal(p);

  return `<tr data-id="${escapeHtml(p.id)}">
        <td><strong>${nombre}</strong></td>
        <td>${catalogo}</td>
        <td>${categoria}</td>
        <td>
          <div class="price-display">
            <span class="product-price">${formatPrecio(precio)}</span>
            <span class="cell-muted">CLP · click derecho para editar producto/precio</span>
          </div>
        </td>
      </tr>`;
}

function updateRows(panel: HTMLElement, productos: ProductoCatalogo[]): void {
  const tbody = panel.querySelector<HTMLTableSectionElement>("tbody");
  if (!tbody) return;

  const query = searchQuery.trim().toLowerCase();
  let filtered = productos.filter((product) => matchesQuery(product, query));

  if (catalogoFiltro) {
    filtered = filtered.filter(
      (product) => productCatalog(product) === catalogoFiltro,
    );
  }

  if (categoriaFiltro) {
    filtered = filtered.filter(
      (product) => productCategory(product) === categoriaFiltro,
    );
  }

  filtered = sortProducts(filtered, sortKey, sortDir);

  tbody.innerHTML =
    filtered.length === 0
      ? `<tr><td colspan="4" class="cell-muted">No hay productos que coincidan con “${escapeHtml(searchQuery)}”.</td></tr>`
      : filtered.map(productRow).join("");

  tbody.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((row) => {
    row.addEventListener("contextmenu", (event) => {
      const id = row.dataset.id;
      if (!id) return;

      const product = productos.find((entry) => entry.id === id);
      if (!product) return;

      event.preventDefault();
      event.stopPropagation();

      const menuItems: ContextMenuItem[] = [
        {
          label: "Editar producto",
          icon: "gear",
          onClick: () => void editarProducto(product),
        },
        {
          label: "Editar precio",
          icon: "gear",
          onClick: () => void editarPrecio(product),
        },
        { separator: true },
        {
          label: "Borrar producto",
          icon: "close",
          danger: true,
          onClick: () => void borrarProducto(product),
        },
      ];

      openContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
    });
  });
}

async function editarPrecio(product: ProductoCatalogo): Promise<void> {
  const actual = getPrecioLocal(product);
  const nuevo = await promptNuevoPrecio(
    actual,
    product.name ?? product.modelo ?? "Producto",
  );
  if (nuevo === null) return;

  setPrecioLocal(product.id, nuevo);

  showToast({
    title: "Precio actualizado",
    message: `${product.name ?? product.modelo ?? "Producto"} → ${formatPrecio(nuevo)}. Sincronizado con Firebase.`,
    tone: "success",
    icon: "gear",
  });
}

async function borrarProducto(product: ProductoCatalogo): Promise<void> {
  const nombre = product.name ?? product.modelo ?? "Producto";

  const confirmado = await showConfirmDialog({
    title: "¿Borrar producto?",
    message: `Se eliminará del catálogo “${nombre}” y dejará de estar disponible en la web y la app móvil. Esta acción no se puede deshacer.`,
    confirmText: "Borrar",
    cancelText: "Cancelar",
    tone: "danger",
  });
  if (!confirmado) return;

  const result = await conLoader(
    eliminarProductoCatalogo(product.id),
    "Eliminando producto…",
  );
  if (result.ok) {
    showToast({
      title: "Producto borrado",
      message: `“${nombre}” fue eliminado del catálogo.`,
      tone: "success",
    });
  } else {
    showToast({
      title: "Error al borrar",
      message: result.error ?? "No se pudo eliminar el producto.",
      tone: "error",
    });
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asString(item)) : [];
}

function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

async function promptEditarProducto(
  product: ProductoCatalogo,
  esNuevo = false,
): Promise<ProductoUpdateLocal | null> {
  const nombre = asString(product.name ?? product.modelo);
  const modelo = asString(product.modelo);
  const serie = asString(product.serie);
  const catalogoActual = catalogoLabel(product);
  const categoria = asString(product.categoria ?? product.category);
  const catalogoIdActual = asString(product.catalog ?? product.catalogo ?? product.catalogue);
  const categoriaIdActual = asString(product.category ?? product.categoria);
  const capacidad = asString(product.capacity);
  const descripcion = asString(product.description);
  const descripcionLarga = asString(product.longDescription);
  const specs = asStringArray(product.specs);
  const features = asStringArray(product.features);
  const isOutOfStock = asBoolean(product.isOutOfStock);
  const disableColors = asBoolean(product.disableColors);
  const disabledColors = asStringArray(product.disabledColors);
  const isPromo = asBoolean(product.isPromo);
  const promoTag = asString(product.promoTag);
  const promoDescription = asString(product.promoDescription);
  const isFeatured = asBoolean(product.isFeatured);
  const precioInicial = getPrecioLocal(product);

  const primerImagen = Array.isArray(product.images)
    ? product.images[0]
    : undefined;
  const srcDeVista = (view: unknown): string => {
    if (view && typeof view === "object") {
      const src = (view as Record<string, unknown>).src;
      return typeof src === "string" ? src : "";
    }
    return "";
  };
  const imagenCarousel =
    (primerImagen && typeof primerImagen === "object"
      ? srcDeVista((primerImagen as Record<string, unknown>).carousel)
      : "") || "";
  const imagenProducto =
    (primerImagen && typeof primerImagen === "object"
      ? srcDeVista((primerImagen as Record<string, unknown>).product)
      : "") || imagenCarousel || "";

  const config = await loadCatalogConfig();

  const catalogoOptions = config.catalogs;
  const categoriaOptions = config.categories;

  const catalogoOptionsCompleto = catalogoOptions.some((c) => c.id === catalogoIdActual)
    ? catalogoOptions
    : catalogoIdActual
      ? [{ id: catalogoIdActual, label: catalogoActual }, ...catalogoOptions]
      : catalogoOptions;

  const catalogoSeleccionado = catalogoOptionsCompleto.some((c) => c.id === catalogoIdActual)
    ? catalogoIdActual
    : catalogoOptionsCompleto[0]?.id ?? "";

  const categoriaOptionsCompleto = (catalogId: string, current: string): { id: string; label: string }[] => {
    const lista = categoriaOptions.filter((c) => c.catalogId === catalogId);
    const conActual = lista.some((c) => c.id === current)
      ? lista
      : current
        ? [{ id: current, label: categoria }, ...lista]
        : lista;
    return conActual;
  };

  const categoriaValida = (catalogId: string, current: string): string => {
    const lista = categoriaOptions.filter((c) => c.catalogId === catalogId);
    if (lista.some((c) => c.id === current)) return current;
    if (current && !categoriaOptions.some((c) => c.id === current)) return current;
    return lista[0]?.id ?? current ?? "";
  };

  const catalogoDisplay = catalogoOptionsCompleto.find((c) => c.id === catalogoSeleccionado)?.label ?? catalogoActual;

  const categoriaSeleccionada = categoriaValida(catalogoSeleccionado, categoriaIdActual);
  const categoriaDisplay =
    categoriaOptions.find((c) => c.id === categoriaSeleccionada)?.label ?? categoria;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "precio-dialog";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute(
      "aria-label",
      `Editar producto ${nombre || "sin nombre"}`,
    );

    let imagenCarouselSel = imagenCarousel;
    let imagenProductoSel = imagenProducto;
    let imagenCambiada = false;
    let focusCarousel = { x: 50, y: 50 };
    let focusProduct = { x: 50, y: 50 };
    try {
      const focusDeVista = (view: unknown): { x: number; y: number } => {
        if (view && typeof view === "object") {
          const f = (view as Record<string, unknown>).focus;
          if (f && typeof f === "object") {
            const x = Number((f as Record<string, unknown>).x);
            const y = Number((f as Record<string, unknown>).y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
              return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
            }
          }
        }
        return { x: 50, y: 50 };
      };
      if (primerImagen && typeof primerImagen === "object") {
        const record = primerImagen as Record<string, unknown>;
        focusCarousel = focusDeVista(record.carousel);
        focusProduct = focusDeVista(record.product);
      }
    } catch {
      // valores por defecto
    }

    const textField = (
      id: string,
      label: string,
      value: string,
      maxLength: number,
      multiline = false,
    ): string => `
      <div class="precio-dialog__field" style="gap: 8px;">
        <label class="precio-dialog__label" for="${id}">${label}</label>
        ${
          multiline
            ? `<textarea id="${id}" class="editar-producto__textarea" maxlength="${maxLength}" rows="3" autocomplete="off">${escapeHtml(value)}</textarea>`
            : `<input id="${id}" class="editar-producto__input" type="text" maxlength="${maxLength}" value="${escapeHtml(value)}" autocomplete="off" />`
        }
      </div>`;

    const listField = (
      id: string,
      label: string,
      items: string[],
      placeholder: string,
    ): string => `
      <div class="precio-dialog__field" style="gap: 8px;">
        <label class="precio-dialog__label" for="${id}">${label}</label>
        <div class="editar-producto__list" data-list="${id}">
          ${
            items.length === 0
              ? `<div class="editar-producto__list-empty">Sin elementos. Agrega uno abajo.</div>`
              : items
                  .map(
                    (item, index) => `
                      <div class="editar-producto__list-item">
                        <input type="text" class="editar-producto__input" data-list-input="${id}" data-index="${index}" maxlength="300" value="${escapeHtml(item)}" placeholder="${placeholder}" autocomplete="off" />
                        <button type="button" class="editar-producto__list-remove" data-list-remove="${id}" data-index="${index}" aria-label="Quitar" title="Quitar">${renderIcon("close", { size: 13 })}</button>
                      </div>`,
                  )
                  .join("")
          }
        </div>
        <button type="button" class="btn btn--secondary btn--sm" data-list-add="${id}">
          ${renderIcon("add", { size: 13 })} Agregar
        </button>
      </div>`;

    const selectField = (
      id: string,
      label: string,
      options: { id: string; label: string }[],
      value: string,
      disabled = false,
    ): string => `
      <div class="precio-dialog__field" style="gap: 8px;">
        <label class="precio-dialog__label" for="${id}">${label}</label>
        <select id="${id}" class="editar-producto__select" ${disabled ? "disabled" : ""}>
          ${options
            .map(
              (option) =>
                `<option value="${escapeHtml(option.id)}"${option.id === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
            )
            .join("")}
        </select>
      </div>`;

    const switchField = (
      id: string,
      label: string,
      hint: string,
      checked: boolean,
      tone: "danger" | "accent" | "warning" = "accent",
    ): string => `
      <div class="editar-producto__toggle">
        <div class="editar-producto__toggle-info">
          <p class="editar-producto__toggle-title">${label}</p>
          <p class="editar-producto__toggle-hint">${hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked="${checked ? "true" : "false"}"
          id="${id}"
          class="editar-producto__switch editar-producto__switch--${tone}${checked ? " is-on" : ""}"
        >
          <span class="editar-producto__switch-knob"></span>
        </button>
      </div>`;

    const swatchesField = (): string => `
      <div class="editar-producto__swatches-wrap" data-swatches ${disableColors ? "hidden" : ""}>
        <p class="editar-producto__swatches-title">Colores bloqueados</p>
        <p class="editar-producto__swatches-hint">Haz clic en los colores que deseas <strong>bloquear / deshabilitar</strong> para este modelo:</p>
        <div class="editar-producto__swatches">
          ${PRODUCT_COLORS.map((color) => {
            const blocked = disabledColors.includes(color.id);
            return `
              <button
                type="button"
                class="editar-producto__swatch${blocked ? " is-blocked" : ""}"
                data-swatch="${color.id}"
                aria-pressed="${blocked ? "true" : "false"}"
                aria-label="Bloquear ${escapeHtml(color.name)}"
                title="${escapeHtml(color.name)}"
              >
                <span class="editar-producto__swatch-dot" style="background:${color.hex}"></span>
                <span class="editar-producto__swatch-name">${escapeHtml(color.name)}</span>
                <span class="editar-producto__swatch-badge" data-swatch-badge>${blocked ? "Bloqueado" : ""}</span>
              </button>`;
          }).join("")}
        </div>
      </div>`;

    overlay.innerHTML = `
      <div class="precio-dialog__panel precio-dialog__panel--editar">
        <header class="precio-dialog__header">
          <div class="precio-dialog__icon" aria-hidden="true">${renderIcon("gear", { size: 20 })}</div>
          <div class="precio-dialog__head">
            <h3 class="precio-dialog__title">${esNuevo ? "Nuevo producto" : "Editar producto"}</h3>
            <p class="precio-dialog__product" title="${escapeHtml(product.id)}">${escapeHtml(esNuevo ? "Se creará al guardar" : product.id)}</p>
          </div>
          <button type="button" class="precio-dialog__close" data-editar-cancel aria-label="Cerrar" title="Cerrar">
            ${renderIcon("close", { size: 18 })}
          </button>
        </header>

        <div class="editar-producto__preview" data-preview>
          <span class="editar-producto__preview-name" data-preview-name>${escapeHtml(nombre || "Nombre del producto")}</span>
          <span class="editar-producto__preview-chip" data-preview-capacity>${escapeHtml(capacidad || "—")}</span>
          <span class="editar-producto__preview-chip" data-preview-catalog>${escapeHtml(catalogoDisplay)}</span>
          <span class="editar-producto__preview-chip" data-preview-category>${escapeHtml(categoriaDisplay)}</span>
        </div>

        <nav class="editar-producto__tabs" role="tablist" aria-label="Secciones del producto">
          ${[
            ["general", "General"],
            ["estado", "Estado y Colores"],
            ["descripcion", "Descripción"],
            ["ficha", "Ficha técnica"],
          ]
            .map(
              ([id, label], i) => `
                <button
                  type="button"
                  class="editar-producto__tab ${i === 0 ? "is-active" : ""}"
                  role="tab"
                  aria-selected="${i === 0 ? "true" : "false"}"
                  data-editar-tab="${id}"
                >${label}</button>`,
            )
            .join("")}
        </nav>

        <div class="precio-dialog__body editar-producto__body">
          <section class="editar-producto__section is-active" data-editar-section="general" role="tabpanel">
            <div class="editar-producto__grid">
              ${textField("editar-nombre", "Nombre", nombre, 160)}
              ${textField("editar-modelo", "Modelo", modelo, 120)}
              ${textField("editar-serie", "Serie", serie, 120)}
              ${selectField("editar-catalogo", "Catálogo", catalogoOptionsCompleto, catalogoSeleccionado)}
              ${selectField("editar-categoria", "Categoría", categoriaOptionsCompleto(catalogoSeleccionado, categoriaIdActual), categoriaValida(catalogoSeleccionado, categoriaIdActual))}
              ${textField("editar-capacity", "Capacidad", capacidad, 120)}
              <div class="precio-dialog__field" style="gap: 8px;">
                <label class="precio-dialog__label" for="editar-precio">Precio (CLP)</label>
                <input id="editar-precio" class="editar-producto__input" type="number" min="0" step="1" inputmode="numeric" value="${precioInicial > 0 ? precioInicial : ""}" placeholder="Ej. 499990" autocomplete="off" />
              </div>
              <div class="editar-producto__image-field">
                <label class="precio-dialog__label">Imágenes del producto</label>
                <p class="editar-producto__image-help">Puedes usar una imagen distinta para el carrusel (inicio) y para la vista de productos. Se optimizan a WebP.</p>
                <div class="editar-producto__images-grid">
                  <div class="editar-producto__image-card" data-image-card-carousel ${imagenCarousel ? "" : "is-empty"}>
                    <span class="editar-producto__image-label">Carrusel · 5:2</span>
                    <div class="editar-producto__image-preview editar-producto__image-preview--carousel" data-image-preview-carousel ${imagenCarousel ? "" : "hidden"}>
                      <img src="${escapeHtml(imagenCarousel)}" alt="Vista carrusel" data-image-img-carousel />
                      <span class="editar-producto__image-focus-dot" data-focus-dot-carousel style="left:${focusCarousel.x}%;top:${focusCarousel.y}%"></span>
                      <div class="editar-producto__image-overlay">
                        <button type="button" class="editar-producto__image-action" data-editar-imagen-carousel>
                          ${renderIcon("box", { size: 14 })} Cambiar
                        </button>
                        <button type="button" class="editar-producto__image-action editar-producto__image-action--danger" data-editar-imagen-carousel-quitar>
                          ${renderIcon("close", { size: 14 })} Quitar
                        </button>
                      </div>
                    </div>
                    <button type="button" class="editar-producto__image-empty" data-image-empty-carousel ${imagenCarousel ? "hidden" : ""} data-editar-imagen-carousel>
                      <span class="editar-producto__image-empty-icon">${renderIcon("box", { size: 24 })}</span>
                      <span class="editar-producto__image-empty-title">+ Agregar carrusel</span>
                      <span class="editar-producto__image-empty-hint">Portada del inicio</span>
                    </button>
                  </div>
                  <div class="editar-producto__image-card" data-image-card-product ${imagenProducto ? "" : "is-empty"}>
                    <span class="editar-producto__image-label">Producto · 3:2</span>
                    <div class="editar-producto__image-preview" data-image-preview-product ${imagenProducto ? "" : "hidden"}>
                      <img src="${escapeHtml(imagenProducto)}" alt="Vista de producto" data-image-img-product />
                      <span class="editar-producto__image-focus-dot" data-focus-dot-product style="left:${focusProduct.x}%;top:${focusProduct.y}%"></span>
                      <div class="editar-producto__image-overlay">
                        <button type="button" class="editar-producto__image-action" data-editar-imagen-product>
                          ${renderIcon("box", { size: 14 })} Cambiar
                        </button>
                        <button type="button" class="editar-producto__image-action editar-producto__image-action--danger" data-editar-imagen-product-quitar>
                          ${renderIcon("close", { size: 14 })} Quitar
                        </button>
                      </div>
                    </div>
                    <button type="button" class="editar-producto__image-empty" data-image-empty-product ${imagenProducto ? "hidden" : ""} data-editar-imagen-product>
                      <span class="editar-producto__image-empty-icon">${renderIcon("box", { size: 24 })}</span>
                      <span class="editar-producto__image-empty-title">+ Agregar producto</span>
                      <span class="editar-producto__image-empty-hint">Catálogo y ficha</span>
                    </button>
                  </div>
                </div>
                <input type="file" accept="image/*" class="editar-producto__image-input" data-image-input-carousel />
                <input type="file" accept="image/*" class="editar-producto__image-input" data-image-input-product />
              </div>
            </div>
          </section>

          <section class="editar-producto__section" data-editar-section="estado" role="tabpanel">
            <div class="editar-producto__grid">
              <div class="editar-producto__toggles">
                ${switchField("editar-out-of-stock", "Modo Agotado", isOutOfStock ? "El equipo figura con insignia de AGOTADO y no se puede cotizar." : "Marca el equipo como sin stock. Aparecerá con insignia de AGOTADO.", isOutOfStock, "danger")}
                ${switchField("editar-disable-colors", "Deshabilitar selección de colores", disableColors ? "Los clientes verán el equipo sin selector de color." : "Bloquea el selector de color en la ficha del producto.", disableColors)}
                ${switchField("editar-is-featured", "Destacar en Inicio", isFeatured ? "El equipo aparece de forma prioritaria en la sección destacada del Inicio." : "Marca este equipo para mostrarlo prioritariamente en la página de inicio.", isFeatured)}
                ${switchField("editar-is-promo", "Producto en Promoción / Oferta", isPromo ? "El equipo se destaca con distintivos de promo en el catálogo y ficha." : "Destaca el equipo con distintivos especiales de promo.", isPromo, "warning")}
              </div>
              <div class="editar-producto__promo-fields" data-promo-fields ${isPromo ? "" : "hidden"}>
                ${textField("editar-promo-tag", "Etiqueta de Promo (Texto corto)", promoTag, 100)}
                ${textField("editar-promo-desc", "Detalle explicativo (Opcional)", promoDescription, 300)}
              </div>
              ${swatchesField()}
            </div>
          </section>

          <section class="editar-producto__section" data-editar-section="descripcion" role="tabpanel">
            <div class="editar-producto__grid">
              ${textField("editar-description", "Descripción corta", descripcion, 500, true)}
              ${textField("editar-long-description", "Descripción larga", descripcionLarga, 5000, true)}
            </div>
          </section>

          <section class="editar-producto__section" data-editar-section="ficha" role="tabpanel">
            <div class="editar-producto__grid">
              ${listField("editar-specs", "Especificaciones", specs, "Ej. 1.800 W de potencia")}
              ${listField("editar-features", "Características", features, "Ej. Fácil de limpiar")}
            </div>
          </section>
        </div>

        <footer class="precio-dialog__footer">
          <button type="button" class="btn btn--secondary" data-editar-cancel>Cancelar</button>
          <button type="button" class="btn btn--primary" data-editar-ok>
            ${renderIcon("check", { size: 16 })} Guardar
          </button>
        </footer>
      </div>
    `;

    const switchState: Record<string, boolean> = {
      "editar-out-of-stock": isOutOfStock,
      "editar-disable-colors": disableColors,
      "editar-is-promo": isPromo,
      "editar-is-featured": isFeatured,
    };

    const blockedColors = new Set(disabledColors);

    overlay
      .querySelectorAll<HTMLButtonElement>("[data-editar-tab]")
      .forEach((tab) => {
        tab.addEventListener("click", () => {
          const id = tab.dataset.editarTab;
          if (!id) return;

          overlay
            .querySelectorAll<HTMLButtonElement>("[data-editar-tab]")
            .forEach((other) => {
              other.classList.toggle("is-active", other === tab);
              other.setAttribute(
                "aria-selected",
                other === tab ? "true" : "false",
              );
            });
          overlay
            .querySelectorAll<HTMLElement>(".editar-producto__section")
            .forEach((section) => {
              section.classList.toggle(
                "is-active",
                section.dataset.editarSection === id,
              );
            });
        });
      });

    overlay
      .querySelectorAll<HTMLButtonElement>(".editar-producto__switch")
      .forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.id;
          switchState[id] = !switchState[id];
          el.classList.toggle("is-on", switchState[id]);
          el.setAttribute("aria-checked", switchState[id] ? "true" : "false");

          if (id === "editar-is-promo") {
            const fields = overlay.querySelector<HTMLElement>("[data-promo-fields]");
            if (fields) fields.hidden = !switchState[id];
          }
          if (id === "editar-disable-colors") {
            const swatches = overlay.querySelector<HTMLElement>("[data-swatches]");
            if (swatches) swatches.hidden = switchState[id];
          }
        });
      });

    overlay
      .querySelectorAll<HTMLButtonElement>("[data-swatch]")
      .forEach((el) => {
        el.addEventListener("click", () => {
          const colorId = el.dataset.swatch;
          if (!colorId) return;

          if (blockedColors.has(colorId)) {
            blockedColors.delete(colorId);
          } else {
            blockedColors.add(colorId);
          }

          const blocked = blockedColors.has(colorId);
          el.classList.toggle("is-blocked", blocked);
          el.setAttribute("aria-pressed", blocked ? "true" : "false");
          const badge = el.querySelector<HTMLElement>("[data-swatch-badge]");
          if (badge) badge.textContent = blocked ? "Bloqueado" : "";
        });
      });

    const actualizarPreviewImagen = (
      view: "carousel" | "product",
      src: string,
    ): void => {
      const preview = overlay.querySelector<HTMLElement>(`[data-image-preview-${view}]`);
      const card = overlay.querySelector<HTMLElement>(`[data-image-card-${view}]`);
      const empty = overlay.querySelector<HTMLButtonElement>(`[data-image-empty-${view}]`);
      const img = preview?.querySelector<HTMLElement>(`[data-image-img-${view}]`);
      const dot = overlay.querySelector<HTMLElement>(`[data-focus-dot-${view}]`);
      if (!preview) return;
      if (src) {
        preview.hidden = false;
        if (empty) empty.hidden = true;
        card?.classList.remove("is-empty");
        const imgEl = preview.querySelector<HTMLImageElement>("img");
        if (imgEl) imgEl.src = src;
        // Al subir una imagen nueva, re-aplica el foco actual (o el centro).
        if (img) {
          const focus = view === "carousel" ? focusCarousel : focusProduct;
          img.style.objectPosition = `${focus.x}% ${focus.y}%`;
        }
        if (dot) {
          const focus = view === "carousel" ? focusCarousel : focusProduct;
          dot.style.left = `${focus.x}%`;
          dot.style.top = `${focus.y}%`;
        }
      } else {
        preview.hidden = true;
        if (empty) empty.hidden = false;
        card?.classList.add("is-empty");
      }
    };

    const bindImageUpload = (
      view: "carousel" | "product",
      inputSelector: string,
      buttonSelector: string,
    ): void => {
      const input = overlay.querySelector<HTMLInputElement>(inputSelector);
      const buttons = overlay.querySelectorAll<HTMLButtonElement>(buttonSelector);

      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          // Click síncrono sobre el input persistente (gesto de usuario directo).
          input?.click();
        });
      });

      input?.addEventListener("change", () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;

        void (async () => {
          const result = await procesarImagenSubida(file, view);
          if (!result) return;
          if (view === "carousel" && result.carouselUrl) {
            imagenCarouselSel = result.carouselUrl;
            imagenCambiada = true;
            actualizarPreviewImagen("carousel", imagenCarouselSel);
          } else if (view === "product" && result.productUrl) {
            imagenProductoSel = result.productUrl;
            imagenCambiada = true;
            actualizarPreviewImagen("product", imagenProductoSel);
          }
        })();
      });
    };

    // Carrusel: botones "agregar" y "cambiar" abren el mismo input.
    bindImageUpload("carousel", "[data-image-input-carousel]", "[data-editar-imagen-carousel]");
    // Producto: botones "agregar" y "cambiar" abren el mismo input.
    bindImageUpload("product", "[data-image-input-product]", "[data-editar-imagen-product]");

    overlay
      .querySelector<HTMLButtonElement>("[data-editar-imagen-carousel-quitar]")
      ?.addEventListener("click", () => {
        imagenCarouselSel = "";
        imagenCambiada = true;
        actualizarPreviewImagen("carousel", "");
      });

    overlay
      .querySelector<HTMLButtonElement>("[data-editar-imagen-product-quitar]")
      ?.addEventListener("click", () => {
        imagenProductoSel = "";
        imagenCambiada = true;
        actualizarPreviewImagen("product", "");
      });

    // Arrastrar la imagen para ajustar el encuadre (focus), como en la web.
    const bindFocusDrag = (view: "carousel" | "product"): void => {
      const preview = overlay.querySelector<HTMLElement>(`[data-image-preview-${view}]`);
      const img = overlay.querySelector<HTMLElement>(`[data-image-img-${view}]`);
      const dot = overlay.querySelector<HTMLElement>(`[data-focus-dot-${view}]`);
      if (!preview || !img || !dot) return;
      const state =
        view === "carousel"
          ? { get: () => focusCarousel, set: (f: { x: number; y: number }) => { focusCarousel = f; } }
          : { get: () => focusProduct, set: (f: { x: number; y: number }) => { focusProduct = f; } };

      const update = (clientX: number, clientY: number): void => {
        const rect = preview.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
        const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
        state.set({ x: Math.round(x), y: Math.round(y) });
        img.style.objectPosition = `${state.get().x}% ${state.get().y}%`;
        dot.style.left = `${state.get().x}%`;
        dot.style.top = `${state.get().y}%`;
        imagenCambiada = true;
      };

      let dragging = false;
      preview.addEventListener("pointerdown", (event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        dragging = true;
        preview.setPointerCapture?.(event.pointerId);
        update(event.clientX, event.clientY);
      });
      preview.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        update(event.clientX, event.clientY);
      });
      const endDrag = (): void => { dragging = false; };
      preview.addEventListener("pointerup", endDrag);
      preview.addEventListener("pointercancel", endDrag);
    };

    bindFocusDrag("carousel");
    bindFocusDrag("product");

    // Campos de lista dinámica (especificaciones y características)
    const renderList = (id: string, values: string[]): void => {
      const container = overlay.querySelector<HTMLElement>(`[data-list="${id}"]`);
      if (!container) return;
      container.innerHTML =
        values.length === 0
          ? `<div class="editar-producto__list-empty">Sin elementos. Agrega uno abajo.</div>`
          : values
              .map(
                (item, index) => `
                  <div class="editar-producto__list-item">
                    <input type="text" class="editar-producto__input" data-list-input="${id}" data-index="${index}" maxlength="300" value="${escapeHtml(item)}" autocomplete="off" />
                    <button type="button" class="editar-producto__list-remove" data-list-remove="${id}" data-index="${index}" aria-label="Quitar" title="Quitar">${renderIcon("close", { size: 13 })}</button>
                  </div>`,
              )
              .join("");
    };

    const listaEstados: Record<string, string[]> = {
      "editar-specs": [...specs],
      "editar-features": [...features],
    };

    overlay.querySelectorAll<HTMLButtonElement>("[data-list-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.listAdd;
        if (!id) return;
        const current = listaEstados[id] ?? [];
        current.push("");
        listaEstados[id] = current;
        renderList(id, current);
        const lastInput = overlay.querySelector<HTMLInputElement>(
          `[data-list="${id}"] [data-list-input]:last-child`,
        );
        lastInput?.focus();
      });
    });

    overlay.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const removeBtn = target.closest<HTMLButtonElement>("[data-list-remove]");
      if (!removeBtn) return;
      const id = removeBtn.dataset.listRemove;
      const index = Number(removeBtn.dataset.index);
      if (!id || !Number.isFinite(index)) return;
      const current = listaEstados[id] ?? [];
      current.splice(index, 1);
      listaEstados[id] = current;
      renderList(id, current);
    });

    overlay.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      const input = target.closest<HTMLInputElement>("[data-list-input]");
      if (!input) return;
      const id = input.dataset.listInput;
      const index = Number(input.dataset.index);
      if (!id || !Number.isFinite(index)) return;
      const current = listaEstados[id] ?? [];
      current[index] = input.value;
      listaEstados[id] = current;
    });

    overlay
      .querySelectorAll<HTMLTextAreaElement>("textarea[maxlength]")
      .forEach((el) => {
        const counter = document.createElement("span");
        counter.className = "editar-producto__count";
        const update = (): void => {
          counter.textContent = `${el.value.length} / ${el.maxLength}`;
        };
        el.insertAdjacentElement("afterend", counter);
        el.addEventListener("input", update);
        update();
      });

    const okBtn = overlay.querySelector<HTMLButtonElement>("[data-editar-ok]")!;
    const cancelBtns = overlay.querySelectorAll<HTMLButtonElement>("[data-editar-cancel]");
    const getValor = (id: string): string =>
      (overlay.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)
        ?.value ?? "").trim();
    const getList = (id: string): string[] =>
      (listaEstados[id] ?? [])
        .map((value) => value.trim())
        .filter(Boolean);

    const previewName = overlay.querySelector<HTMLElement>("[data-preview-name]");
    const previewCapacity = overlay.querySelector<HTMLElement>("[data-preview-capacity]");
    const previewCatalog = overlay.querySelector<HTMLElement>("[data-preview-catalog]");
    const previewCategory = overlay.querySelector<HTMLElement>("[data-preview-category]");
    overlay
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
      .forEach((input) => {
        input.addEventListener("input", () => {
          if (!previewName || !previewCapacity) return;
          if (input.id === "editar-nombre") {
            previewName.textContent = input.value.trim() || "Nombre del producto";
          }
          if (input.id === "editar-capacity") {
            previewCapacity.textContent = input.value.trim() || "—";
          }
        });
      });

    const catalogSelect = overlay.querySelector<HTMLSelectElement>("#editar-catalogo");
    const categorySelect = overlay.querySelector<HTMLSelectElement>("#editar-categoria");
    const renderCategorias = (catalogId: string, current: string): void => {
      if (!categorySelect) return;
      const lista = categoriaOptionsCompleto(catalogId, current);
      const next = categoriaValida(catalogId, current);
      categorySelect.innerHTML = lista
        .map(
          (option) =>
            `<option value="${escapeHtml(option.id)}"${option.id === next ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
        )
        .join("");
    };
    catalogSelect?.addEventListener("change", () => {
      renderCategorias(catalogSelect.value, "");
      if (previewCatalog && previewCategory) {
        previewCatalog.textContent =
          catalogoOptionsCompleto.find((c) => c.id === catalogSelect.value)?.label ?? catalogSelect.value;
        previewCategory.textContent =
          categoriaOptions.find((c) => c.id === categorySelect?.value)?.label ??
          categorySelect?.value ??
          "—";
      }
    });
    categorySelect?.addEventListener("change", () => {
      if (previewCategory) {
        previewCategory.textContent =
          categoriaOptions.find((c) => c.id === categorySelect.value)?.label ??
          categorySelect.value ??
          "—";
      }
    });

    let resolved = false;
    const cerrar = (value: ProductoUpdateLocal | null): void => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      resolve(value);
    };

    okBtn.addEventListener("click", () => {
      const precioRaw = getValor("editar-precio");
      const precioNum = precioRaw
        ? Math.max(0, Number(precioRaw.replace(/[^0-9]/g, "")) || 0)
        : 0;

      const updates: ProductoUpdateLocal = {
        name: getValor("editar-nombre") || undefined,
        modelo: getValor("editar-modelo") || undefined,
        serie: getValor("editar-serie") || undefined,
        catalog: getValor("editar-catalogo") || "",
        catalogo: getValor("editar-catalogo") || "",
        category: getValor("editar-categoria") || "",
        categoria: getValor("editar-categoria") || "",
        capacity: getValor("editar-capacity") || undefined,
        description: getValor("editar-description") || undefined,
        longDescription: getValor("editar-long-description") || "",
        specs: getList("editar-specs"),
        features: getList("editar-features"),
        isOutOfStock: switchState["editar-out-of-stock"],
        disableColors: switchState["editar-disable-colors"],
        isPromo: switchState["editar-is-promo"],
        isFeatured: switchState["editar-is-featured"],
        promoTag: getValor("editar-promo-tag") || undefined,
        promoDescription: getValor("editar-promo-desc") || undefined,
        disabledColors: [...blockedColors],
      };

      if (precioNum > 0) {
        updates.listPrice = precioNum;
        updates.price = precioNum;
        updates.precio = precioNum;
      }

      if (imagenCambiada) {
        if (imagenCarouselSel || imagenProductoSel) {
          const carouselSrc = imagenCarouselSel || imagenProductoSel;
          const productSrc = imagenProductoSel || imagenCarouselSel;
          updates.images = [
            {
              carousel: { src: carouselSrc, focus: { ...focusCarousel } },
              product: { src: productSrc, focus: { ...focusProduct } },
            },
          ];
        } else {
          updates.images = [];
        }
      }

      if (!updates.name && !updates.modelo && !updates.catalogo && !updates.categoria && !updates.capacity && !updates.specs?.length && !updates.features?.length) {
        cerrar(null);
        return;
      }

      cerrar(updates);
    });
    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cerrar(null)));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cerrar(null);
    });
    overlay.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((input) => {
      input.addEventListener("keydown", (ev: Event) => {
        const event = ev as KeyboardEvent;
        if (event.key === "Escape") {
          event.preventDefault();
          cerrar(null);
          return;
        }
        // Enter guarda el producto, salvo en áreas de texto multilínea.
        if (event.key === "Enter" && !(input instanceof HTMLTextAreaElement)) {
          event.preventDefault();
          okBtn.click();
        }
      });
    });
    overlay.querySelector<HTMLInputElement>("#editar-nombre")?.focus();

    document.body.appendChild(overlay);
  });
}

async function editarProducto(product: ProductoCatalogo): Promise<void> {
  const nombre = product.name ?? product.modelo ?? "Producto";

  const campos = await promptEditarProducto(product);
  if (campos === null) return;

  const result = await actualizarProductoCatalogo(product.id, campos);

  if (result.ok) {
    showToast({
      title: "Producto actualizado",
      message: `“${campos.name ?? nombre}” fue actualizado y sincronizado en la web y la app móvil.`,
      tone: "success",
      icon: "gear",
    });
  } else {
    showToast({
      title: "Error al actualizar",
      message: result.error ?? "No se pudo actualizar el producto.",
      tone: "error",
    });
  }
}

function importarJson(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.style.display = "none";
  document.body.appendChild(input);

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    void (async () => {
      try {
        const text = await file.text();
        const body: unknown = JSON.parse(text);
        const parsed = parseImportJson(body);

        if (parsed.rows.length === 0) {
          showToast({
            title: "No hay productos válidos",
            message: parsed.errors[0]?.message ?? "El JSON no contiene filas con id y nombre.",
            tone: "warning",
            icon: "information",
          });
          return;
        }

        if (parsed.errors.length > 0) {
          showToast({
            title: "Filas omitidas",
            message: `${parsed.errors.length} fila(s) sin id o nombre fueron ignoradas.`,
            tone: "info",
            icon: "information",
          });
        }

        const { nuevos, actualizan } = previewImportacion(parsed.rows);

        const confirmado = await showConfirmDialog({
          title: "Importar productos",
          message: `${parsed.rows.length} productos en el archivo · ${nuevos} nuevos · ${actualizan} actualizarán precio y serie. Se aplica la misma lógica de la web (catálogo/categoría automáticos).`,
          confirmText: "Importar",
          cancelText: "Cancelar",
          tone: "info",
          icon: "box",
        });

        if (!confirmado) return;

        const resumen = await importarProductos(parsed.rows);

        if (resumen.failed.length === 0) {
          showToast({
            title: "Importación completada",
            message: `${resumen.created} creados · ${resumen.updated} actualizados (de ${resumen.total}).`,
            tone: "success",
            icon: "check",
            durationMs: 8000,
          });
        } else {
          showToast({
            title: "Importación con errores",
            message: `${resumen.created} creados · ${resumen.updated} actualizados · ${resumen.failed.length} fallaron (ej: ${resumen.failed[0]?.message ?? "desconocido"}).`,
            tone: "warning",
            icon: "information",
            durationMs: 12000,
          });
        }
      } catch {
        showToast({
          title: "JSON inválido",
          message: "El archivo no es un JSON válido o tiene un formato inesperado.",
          tone: "error",
          icon: "close",
        });
      }
    })();
  });

  input.click();
}

async function nuevoProducto(): Promise<void> {
  const vacio: ProductoCatalogo = {
    id: "",
    name: "",
    modelo: "",
    serie: "",
    catalog: "",
    catalogo: "",
    category: "",
    categoria: "",
    capacity: "",
    description: "",
    longDescription: "",
    specs: [],
    features: [],
    isOutOfStock: false,
    disableColors: false,
    isPromo: false,
    isFeatured: false,
    promoTag: "",
    promoDescription: "",
    disabledColors: [],
  };

  const campos = await promptEditarProducto(vacio, true);
  if (campos === null) return;

  if (!campos.name?.trim()) {
    showToast({
      title: "Falta el nombre",
      message: "El nombre del producto es obligatorio para crearlo.",
      tone: "warning",
    });
    return;
  }

  const result = await crearProductoCatalogo(campos);

  if (result.ok) {
    if (result.id && campos.listPrice && campos.listPrice > 0) {
      setPrecioLocal(result.id, campos.listPrice);
    }
    showToast({
      title: "Producto creado",
      message: `“${campos.name}” fue creado y sincronizado en la web y la app móvil.`,
      tone: "success",
      icon: "add",
    });
  } else {
    showToast({
      title: "Error al crear",
      message: result.error ?? "No se pudo crear el producto.",
      tone: "error",
    });
  }
}

function promptNuevoPrecio(actual: number, productName: string): Promise<number | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "precio-dialog";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `Editar precio de ${productName}`);

    overlay.innerHTML = `
      <div class="precio-dialog__panel">
        <header class="precio-dialog__header">
          <div class="precio-dialog__icon" aria-hidden="true">${renderIcon("gear", { size: 20 })}</div>
          <div class="precio-dialog__head">
            <h3 class="precio-dialog__title">Editar precio</h3>
            <p class="precio-dialog__product">${escapeHtml(productName)}</p>
          </div>
          <button type="button" class="precio-dialog__close" data-precio-cancel aria-label="Cerrar" title="Cerrar">
            ${renderIcon("close", { size: 18 })}
          </button>
        </header>

        <div class="precio-dialog__body">
          <div class="precio-dialog__current">
            <span class="precio-dialog__current-label">Precio actual</span>
            <span class="precio-dialog__current-value">${formatPrecio(actual)}</span>
          </div>

          <div class="precio-dialog__field">
            <label class="precio-dialog__label" for="precio-nuevo-input">Nuevo precio</label>
            <div class="precio-dialog__input-wrap">
              <span class="precio-dialog__prefix">$</span>
              <input
                id="precio-nuevo-input"
                class="precio-dialog__input"
                type="number"
                min="0"
                step="1"
                value="${actual}"
                inputmode="numeric"
                autocomplete="off"
              />
            </div>
            <div class="precio-dialog__preview" data-precio-preview>${formatPrecio(actual)}</div>
          </div>

          <div class="precio-dialog__chips">
            <button type="button" class="chip" data-chip="0.95" title="Bajar 5%">−5%</button>
            <button type="button" class="chip" data-chip="1.05" title="Subir 5%">+5%</button>
            <button type="button" class="chip" data-chip="1.10" title="Subir 10%">+10%</button>
            <button type="button" class="chip" data-chip="1.15" title="Subir 15%">+15%</button>
            <button type="button" class="chip" data-chip="1.25" title="Subir 25%">+25%</button>
          </div>
        </div>

        <footer class="precio-dialog__footer">
          <button type="button" class="btn btn--secondary" data-precio-cancel>Cancelar</button>
          <button type="button" class="btn btn--primary" data-precio-ok>
            ${renderIcon("check", { size: 16 })} Guardar
          </button>
        </footer>
      </div>
    `;

    const okBtn = overlay.querySelector<HTMLButtonElement>("[data-precio-ok]")!;
    const cancelBtns = overlay.querySelectorAll<HTMLButtonElement>("[data-precio-cancel]");
    const input = overlay.querySelector<HTMLInputElement>(".precio-dialog__input")!;
    const preview = overlay.querySelector<HTMLDivElement>("[data-precio-preview]")!;

    const parseValue = (): number => {
      const raw = Number(String(input.value).replace(/[^0-9]/g, ""));
      return Number.isFinite(raw) ? Math.max(0, raw) : 0;
    };

    const updatePreview = (): void => {
      preview.textContent = formatPrecio(parseValue());
    };

    let resolved = false;
    const cerrar = (value: number | null): void => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      resolve(value);
    };

    okBtn.addEventListener("click", () => cerrar(parseValue()));
    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cerrar(null)));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cerrar(null);
    });
    input.addEventListener("input", updatePreview);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        cerrar(parseValue());
      } else if (event.key === "Escape") {
        event.preventDefault();
        cerrar(null);
      }
    });

    overlay.querySelectorAll<HTMLButtonElement>("[data-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const factor = Number(chip.dataset.chip);
        if (!Number.isFinite(factor) || factor <= 0) return;
        input.value = String(Math.max(0, Math.round(actual * factor)));
        updatePreview();
        input.focus();
        input.select();
      });
    });

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

function updateSortHeaders(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((btn) => {
    const key = btn.dataset.sort as SortKey;
    const active = sortKey === key;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (sortDir === "asc" ? "ascending" : "descending") : "none",
    );
    const icon = btn.querySelector<HTMLElement>(".data-table__sort-icon");
    if (!icon) return;
    icon.textContent = active
      ? sortDir === "asc"
        ? " ▲"
        : " ▼"
      : "";
  });
}

async function drawProductos(productos: ProductoCatalogo[]): Promise<void> {
  const panel = document.getElementById("productos-root");
  const filtros = document.getElementById("productos-filtros");
  if (!panel) return;

  if (productos.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
        <h2 class="empty-state__title">Catálogo vacío</h2>
        <p class="empty-state__text">No se encontraron productos en Firestore. Sincroniza el catálogo desde la web.</p>
      </div>`;
    return;
  }

  // Deja el shell estático intacto; solo re-renderiza las filas.
  const actualizarClear = (input: HTMLInputElement): void => {
    const clearBtn = input
      .closest(".search-field")
      ?.querySelector<HTMLButtonElement>(`[data-clear="${input.id}"]`);
    if (!clearBtn) return;
    clearBtn.classList.toggle("is-visible", input.value.length > 0);
  };

  const searchInput = document.getElementById("productos-search");
  if (!searchInput) {
    const categoriaOptions = await loadCategoriaOptions();
    const catalogoOptions = await loadCatalogoOptions();

    const filtrosEl = filtros ?? panel;
    filtrosEl.innerHTML = `
      <div class="productos-filtros__group">
        <div class="search-field" style="flex: 1 1 260px; max-width: 360px;">
          <span class="search-field__icon" aria-hidden="true">${renderIcon("search", { size: 17 })}</span>
          <input
            id="productos-search"
            class="search-input"
            type="search"
            placeholder="Buscar producto, catálogo o categoría…"
            value="${escapeHtml(searchQuery)}"
            aria-label="Buscar productos"
          />
          <button type="button" class="search-field__clear" data-clear="productos-search" aria-label="Limpiar búsqueda" title="Limpiar">
            ${renderIcon("close", { size: 14 })}
          </button>
        </div>
      </div>`;

    if (filtrosEl === panel) {
      panel.insertAdjacentHTML(
        "afterbegin",
        `<div class="conn-updated">Los precios se sincronizan en tiempo real con Firebase: un cambio aquí o en la app móvil se refleja al instante en todas las instalaciones.</div>`,
      );
    }

    const group = filtrosEl.querySelector<HTMLElement>(
      ".productos-filtros__group",
    );

    const categoriaOptionsFor = (): SelectFieldOption[] => {
      const opciones = catalogoFiltro
        ? categoriaOptions.filter((c) => c.catalogId === catalogoFiltro)
        : categoriaOptions;
      return [
        { value: "", label: "Todas las categorías" },
        ...opciones.map((c) => ({ value: c.id, label: c.label })),
      ];
    };

    const catalogoField = createSelectField({
      options: [
        { value: "", label: "Todos los catálogos" },
        ...catalogoOptions.map((c) => ({
          value: c.id,
          label: c.label,
        })),
      ],
      value: catalogoFiltro,
      ariaLabel: "Filtrar por catálogo",
      placeholder: "Todos los catálogos",
      onChange: (value) => {
        catalogoFiltro = value;

        if (catalogoFiltro) {
          const valida = categoriaOptions.some(
            (c) => c.id === categoriaFiltro && c.catalogId === catalogoFiltro,
          );
          if (categoriaFiltro && !valida) {
            categoriaFiltro = "";
          }
        }

        categoriaField.setOptions(categoriaOptionsFor());
        categoriaField.setValue(categoriaFiltro, true);
        updateRows(panel, getCatalogo());
      },
    });

    const categoriaField: SelectField = createSelectField({
      options: categoriaOptionsFor(),
      value: categoriaFiltro,
      ariaLabel: "Filtrar por categoría",
      placeholder: "Todas las categorías",
      onChange: (value) => {
        categoriaFiltro = value;
        updateRows(panel, getCatalogo());
      },
    });

    group?.append(catalogoField.root, categoriaField.root);

    const input = document.getElementById("productos-search") as HTMLInputElement;
    input.addEventListener("input", () => {
      searchQuery = input.value;
      updateRows(panel, getCatalogo());
      actualizarClear(input);
    });

    const clearBtn = document.querySelector<HTMLButtonElement>('[data-clear="productos-search"]');
    clearBtn?.addEventListener("click", () => {
      input.value = "";
      searchQuery = "";
      updateRows(panel, getCatalogo());
      actualizarClear(input);
      input.focus();
    });
    actualizarClear(input);

    panel.innerHTML = `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th><button type="button" class="data-table__sort" data-sort="nombre">Nombre<span class="data-table__sort-icon" aria-hidden="true"></span></button></th>
            <th><button type="button" class="data-table__sort" data-sort="catalogo">Catálogo<span class="data-table__sort-icon" aria-hidden="true"></span></button></th>
            <th><button type="button" class="data-table__sort" data-sort="categoria">Categoría<span class="data-table__sort-icon" aria-hidden="true"></span></button></th>
            <th>Precio</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>`;

    panel.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.sort as SortKey;
        if (sortKey === key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = key;
          sortDir = "asc";
        }
        updateSortHeaders(panel);
        updateRows(panel, getCatalogo());
      });
    });
  }

  updateSortHeaders(panel);
  updateRows(panel, productos);
}

async function renderProductos(): Promise<void> {
  const panel = document.getElementById("productos-root");
  if (!panel) return;

  const productos = getCatalogo();

  if (!hasLoaded && productos.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
        <h2 class="empty-state__title">Cargando catálogo…</h2>
        <p class="empty-state__text">Consultando Firestore.</p>
      </div>`;

    try {
      await loadCatalogo();
    } catch {
      // loadCatalogo emite igual; si falla, se muestra el estado vacío
    }
    hasLoaded = true;
    if (getCatalogo().length === 0) {
      await drawProductos([]);
    }
    return;
  }

  await drawProductos(productos);
}

async function subirPrecios(): Promise<void> {
  if (syncing) return;
  syncing = true;

  const btn = document.querySelector<HTMLButtonElement>('[data-action="sync-precios"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Sincronizando…";
  }

  try {
    const result = await syncAllPreciosToServer();
    if (result.ok) {
      showToast({
        title: "Precios sincronizados",
        message: `${result.total} precio(s) subidos a Firebase. Cualquier instalación los tendrá.`,
        tone: "success",
      });
    } else {
      showToast({
        title: "Sincronización parcial",
        message: `${result.total - result.failed.length} de ${result.total} subidos. Error de ejemplo: ${result.failed[0]?.reason ?? "desconocido"}.`,
        tone: "warning",
      });
    }
  } catch (error) {
    showToast({
      title: "No se pudieron subir los precios",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    syncing = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${renderIcon("refresh", { size: 16 })} Sincronizar precios`;
    }
  }
}

export function initProductosView(): void {
  startCatalogoLive();
  subscribeCatalogo(() => void renderProductos());
  void renderProductos();
  void subirPrecios();

  document
    .querySelector<HTMLButtonElement>('[data-action="sync-precios"]')
    ?.addEventListener("click", () => void subirPrecios());

  document
    .querySelector<HTMLButtonElement>('[data-action="nuevo-producto"]')
    ?.addEventListener("click", () => void nuevoProducto());

  document
    .querySelector<HTMLButtonElement>('[data-action="importar-json"]')
    ?.addEventListener("click", () => importarJson());
}
