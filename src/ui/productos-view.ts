import {
  actualizarProductoCatalogo,
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
import { renderIcon } from "./icons";
import { showToast } from "./toast";
import { openContextMenu, type ContextMenuItem } from "./context-menu";
import { showConfirmDialog } from "./confirm-dialog";
import { PRODUCT_COLORS } from "../lib/product-colors";
import { loadCatalogConfig } from "../services/catalog-config";

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

async function loadCategoriaOptions(): Promise<{ id: string; label: string }[]> {
  if (categoriaOptionsCache) return categoriaOptionsCache;
  try {
    const config = await loadCatalogConfig();
    categoriaOptionsCache = config.categories.map((c) => ({
      id: c.id,
      label: c.label,
    }));
  } catch {
    categoriaOptionsCache = [];
  }
  return categoriaOptionsCache;
}

let hasLoaded = false;
let syncing = false;
let searchQuery = "";
let categoriaFiltro = "";
let sortKey: "nombre" | "catalogo" | "categoria" | null = null;
let sortDir: "asc" | "desc" = "asc";
let categoriaOptionsCache: { id: string; label: string }[] | null = null;

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

  const result = await eliminarProductoCatalogo(product.id);
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

    const linesField = (
      id: string,
      label: string,
      lines: string[],
    ): string => `
      <div class="precio-dialog__field" style="gap: 8px;">
        <label class="precio-dialog__label" for="${id}">${label} <span class="cell-muted">(una por línea)</span></label>
        <textarea id="${id}" class="editar-producto__textarea" rows="4" autocomplete="off">${escapeHtml(lines.join("\n"))}</textarea>
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
            <h3 class="precio-dialog__title">Editar producto</h3>
            <p class="precio-dialog__product" title="${escapeHtml(product.id)}">${escapeHtml(product.id)}</p>
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
            ["promo", "Promoción"],
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
            </div>
          </section>

          <section class="editar-producto__section" data-editar-section="estado" role="tabpanel">
            <div class="editar-producto__grid">
              <div class="editar-producto__toggles">
                ${switchField("editar-out-of-stock", "Modo Agotado", isOutOfStock ? "El equipo figura con insignia de AGOTADO y no se puede cotizar." : "Marca el equipo como sin stock. Aparecerá con insignia de AGOTADO.", isOutOfStock, "danger")}
                ${switchField("editar-disable-colors", "Deshabilitar selección de colores", disableColors ? "Los clientes verán el equipo sin selector de color." : "Bloquea el selector de color en la ficha del producto.", disableColors)}
                ${switchField("editar-is-featured", "Destacar en Inicio", isFeatured ? "El equipo aparece de forma prioritaria en la sección destacada del Inicio." : "Marca este equipo para mostrarlo prioritariamente en la página de inicio.", isFeatured)}
              </div>
              ${swatchesField()}
            </div>
          </section>

          <section class="editar-producto__section" data-editar-section="promo" role="tabpanel">
            <div class="editar-producto__grid">
              ${switchField("editar-is-promo", "Producto en Promoción / Oferta", isPromo ? "El equipo se destaca con distintivos de promo en el catálogo y ficha." : "Destaca el equipo con distintivos especiales de promo.", isPromo, "warning")}
              <div class="editar-producto__promo-fields" data-promo-fields ${isPromo ? "" : "hidden"}>
                ${textField("editar-promo-tag", "Etiqueta de Promo (Texto corto)", promoTag, 100)}
                ${textField("editar-promo-desc", "Detalle explicativo (Opcional)", promoDescription, 300)}
              </div>
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
              ${linesField("editar-specs", "Especificaciones", specs)}
              ${linesField("editar-features", "Características", features)}
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
    const getLines = (id: string): string[] =>
      getValor(id)
        .split("\n")
        .map((line) => line.trim())
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
        specs: getLines("editar-specs"),
        features: getLines("editar-features"),
        isOutOfStock: switchState["editar-out-of-stock"],
        disableColors: switchState["editar-disable-colors"],
        isPromo: switchState["editar-is-promo"],
        isFeatured: switchState["editar-is-featured"],
        promoTag: getValor("editar-promo-tag") || undefined,
        promoDescription: getValor("editar-promo-desc") || undefined,
        disabledColors: [...blockedColors],
      };

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
    const clearBtn = panel.querySelector<HTMLButtonElement>(`[data-clear="${input.id}"]`);
    if (!clearBtn) return;
    clearBtn.classList.toggle("is-visible", input.value.length > 0);
  };

  const searchInput = panel.querySelector<HTMLInputElement>("#productos-search");
  if (!searchInput) {
    const categoriaOptions = await loadCategoriaOptions();

    panel.innerHTML = `
      <div class="conn-updated">Los precios se sincronizan en tiempo real con Firebase: un cambio aquí o en la app móvil se refleja al instante en todas las instalaciones.</div>
      <div class="productos-toolbar" style="display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0 0 1rem;">
        <div class="search-field" style="flex: 1 1 280px; max-width: 420px;">
          <span class="search-field__icon" aria-hidden="true">${renderIcon("search", { size: 17 })}</span>
          <input
            id="productos-search"
            class="search-input"
            type="search"
            placeholder="Buscar por nombre, catálogo o categoría…"
            value="${escapeHtml(searchQuery)}"
            aria-label="Buscar productos"
          />
          <button type="button" class="search-field__clear" data-clear="productos-search" aria-label="Limpiar búsqueda" title="Limpiar">
            ${renderIcon("close", { size: 14 })}
          </button>
        </div>
        <select
          id="productos-categoria"
          class="productos-select"
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          ${categoriaOptions
            .map(
              (option) =>
                `<option value="${escapeHtml(option.id)}"${option.id === categoriaFiltro ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
            )
            .join("")}
        </select>
      </div>
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

    const input = panel.querySelector<HTMLInputElement>("#productos-search")!;
    input.addEventListener("input", () => {
      searchQuery = input.value;
      updateRows(panel, getCatalogo());
      actualizarClear(input);
    });

    const clearBtn = panel.querySelector<HTMLButtonElement>('[data-clear="productos-search"]');
    clearBtn?.addEventListener("click", () => {
      input.value = "";
      searchQuery = "";
      updateRows(panel, getCatalogo());
      actualizarClear(input);
      input.focus();
    });
    actualizarClear(input);

    const categoriaSelect = panel.querySelector<HTMLSelectElement>("#productos-categoria");
    categoriaSelect?.addEventListener("change", () => {
      categoriaFiltro = categoriaSelect.value;
      updateRows(panel, getCatalogo());
    });

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
}
