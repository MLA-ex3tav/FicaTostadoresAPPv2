import {
  getPrecioLocal,
  loadCatalogo,
  type ProductoCatalogo,
} from "../services/catalog";
import {
  registrarOrdenTrabajo,
  type SolicitudRemota,
} from "../lib/web-api";
import { generarCotizacionPdf, descargarPdf, invalidarCotizacionPdf, invalidarOrdenTrabajoPdf } from "../services/cotizacion-pdf";
import { openPdfViewer } from "./pdf-viewer";
import {
  actualizarCotizacionRemota,
  refreshSolicitudes,
} from "../services/solicitudes";
import { enqueueOp } from "../lib/offline-queue";
import { getNetworkState } from "../lib/network";
import { getDraft, saveDraft, clearDraft } from "../lib/drafts";
import { showToast } from "./toast";
import { renderIcon } from "./icons";
import { showConfirmDialog } from "./confirm-dialog";
import {
  PRODUCT_COLORS,
  DEFAULT_PRODUCT_COLOR_ID,
  getProductColorById,
  getProductColorLabel,
} from "../lib/product-colors";
import {
  caretAfterDigits,
  countDigitsBefore,
  formatPhoneNumber,
} from "../lib/phone-format";
import {
  emailLocalPart,
  needsEmailDomainCompletion,
  suggestEmailDomains,
} from "../lib/email-format";

const ORIGEN_FICA =
  "San Ramón Pc. 39 Lt. 12-19, Padre Las Casas, Chile";

interface ClienteDatos {
  name: string;
  phone: string;
  rut: string;
  email: string;
  comuna: string;
  address: string;
}

interface ItemSeleccionado {
  quantity: number;
  selectedColorId: string;
  selectedColor: string;
}

interface EstadoWizard {
  step: 1 | 2 | 3;
  productos: ProductoCatalogo[] | null;
  loading: boolean;
  query: string;
  seleccion: Record<string, ItemSeleccionado>;
  collapsing: string | null;
  cliente: ClienteDatos;
  message: string;
  generating: boolean;
}

const STEPS = ["Datos", "Productos", "Enviar"];

const DRAFT_KIND = "cotizacion";

interface BorradorCotizacion {
  step: EstadoWizard["step"];
  query: string;
  cliente: ClienteDatos;
  seleccion: Record<string, ItemSeleccionado>;
  message: string;
}

let modal: HTMLElement | null = null;
let lastStep = 0;
let draftTimer: number | null = null;

/** Id de la cotización que se está editando (null = nueva). */
let editingId: string | null = null;
let editingItem: SolicitudRemota | null = null;

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

function cleanState(): EstadoWizard {
  return {
    step: 1,
    productos: null,
    loading: true,
    query: "",
    seleccion: {},
    collapsing: null,
    cliente: { name: "", phone: "", rut: "", email: "", comuna: "", address: "" },
    message: "",
    generating: false,
  };
}

function defaultItem(colorId?: string | null, color?: string | null): ItemSeleccionado {
  const id = colorId ?? DEFAULT_PRODUCT_COLOR_ID;
  return {
    quantity: 1,
    selectedColorId: id,
    selectedColor: color ?? getProductColorLabel(id) ?? "",
  };
}

function hasContent(state: EstadoWizard): boolean {
  return (
    Object.values(state.cliente).some((value) => value.trim()) ||
    state.message.trim().length > 0 ||
    Object.keys(state.seleccion).length > 0
  );
}

/* ── Autosave de borradores (sobrevive a cierres forzosos) ── */

function serializarBorrador(state: EstadoWizard): BorradorCotizacion {
  return {
    step: state.step,
    query: state.query,
    cliente: { ...state.cliente },
    seleccion: Object.fromEntries(
      Object.entries(state.seleccion).map(([id, item]) => [id, { ...item }]),
    ),
    message: state.message,
  };
}

function aplicarBorrador(state: EstadoWizard, data: BorradorCotizacion): void {
  if (data.step === 1 || data.step === 2 || data.step === 3) {
    state.step = data.step;
  }
  if (typeof data.query === "string") {
    state.query = data.query;
  }
  if (typeof data.message === "string") {
    state.message = data.message;
  }
  if (data.cliente && typeof data.cliente === "object") {
    for (const key of Object.keys(state.cliente)) {
      const value = data.cliente[key as keyof ClienteDatos];
      if (typeof value === "string") {
        state.cliente[key as keyof ClienteDatos] = value;
      }
    }
  }
  if (data.seleccion && typeof data.seleccion === "object") {
    state.seleccion = {};
    for (const [productId, item] of Object.entries(data.seleccion)) {
      const rec = item as Partial<ItemSeleccionado> | undefined;
      state.seleccion[productId] = {
        quantity: Math.max(1, Number(rec?.quantity ?? 1) || 1),
        selectedColorId:
          typeof rec?.selectedColorId === "string"
            ? rec.selectedColorId
            : DEFAULT_PRODUCT_COLOR_ID,
        selectedColor:
          typeof rec?.selectedColor === "string" ? rec.selectedColor : "",
      };
    }
  }
}

/** Guarda el borrador (debounced) cuando hay contenido y no es una edición. */
function scheduleSave(state: EstadoWizard): void {
  if (editingId) return;
  if (!hasContent(state)) return;

  if (draftTimer !== null) {
    window.clearTimeout(draftTimer);
  }
  draftTimer = window.setTimeout(() => {
    draftTimer = null;
    void saveDraft(DRAFT_KIND, serializarBorrador(state));
  }, 400);
}

function seleccionItems(state: EstadoWizard): {
  product: ProductoCatalogo;
  quantity: number;
  selectedColorId?: string;
  selectedColor?: string;
}[] {
  const catalogo = state.productos ?? [];
  const items: {
    product: ProductoCatalogo;
    quantity: number;
    selectedColorId?: string;
    selectedColor?: string;
  }[] = [];
  for (const [productId, item] of Object.entries(state.seleccion)) {
    const product = catalogo.find((p) => p.id === productId);
    if (product) {
      items.push({
        product,
        quantity: item.quantity,
        selectedColorId: item.selectedColorId,
        selectedColor: item.selectedColor,
      });
    }
  }
  return items;
}

function totalProductos(state: EstadoWizard): number {
  return Object.values(state.seleccion).reduce((sum, item) => sum + item.quantity, 0);
}

function totalCotizacion(state: EstadoWizard): number {
  return seleccionItems(state).reduce(
    (sum, item) => sum + getPrecioLocal(item.product) * item.quantity,
    0,
  );
}

function stepIndicator(step: number): string {
  return `
    <div class="cotizacion-steps" aria-label="Progreso de la cotización">
      <div class="cotizacion-step ${step === 1 ? "cotizacion-step--active" : step > 1 ? "cotizacion-step--done" : ""}">
        <span class="cotizacion-step__dot">${step > 1 ? "✓" : "1"}</span>
        <span class="cotizacion-step__label">Datos</span>
      </div>

      <div class="cotizacion-step__line ${step > 1 ? "cotizacion-step__line--done" : ""}"></div>

      <div class="cotizacion-step ${step === 2 ? "cotizacion-step--active" : step > 2 ? "cotizacion-step--done" : ""}">
        <span class="cotizacion-step__dot">${step > 2 ? "✓" : "2"}</span>
        <span class="cotizacion-step__label">Productos</span>
      </div>

      <div class="cotizacion-step__line ${step > 2 ? "cotizacion-step__line--done" : ""}"></div>

      <div class="cotizacion-step ${step === 3 ? "cotizacion-step--active" : step > 3 ? "cotizacion-step--done" : ""}">
        <span class="cotizacion-step__dot">${step > 3 ? "✓" : "3"}</span>
        <span class="cotizacion-step__label">Enviar</span>
      </div>
    </div>`;
}

function renderStep1(state: EstadoWizard): string {
  const c = state.cliente;
  return `
    <section class="cotizacion-form">
      <div class="cotizacion-form__grid">
        <div class="cotizacion-field" data-cotizacion-field-wrap="name">
          <label class="cotizacion-field__label" for="nc-name">Nombre / Razón social *</label>
          <input id="nc-name" class="cotizacion-field__input" type="text" value="${escapeHtml(c.name)}" placeholder="Ej. Juan Pérez" data-cotizacion-field="name" />
        </div>
        <div class="cotizacion-field">
          <label class="cotizacion-field__label" for="nc-phone">Teléfono</label>
          <input id="nc-phone" class="cotizacion-field__input" type="tel" value="${escapeHtml(c.phone)}" placeholder="+56 9 1234 5678" data-cotizacion-field="phone" />
          <span class="cotizacion-field__hint" data-phone-hint aria-live="polite"></span>
        </div>
        <div class="cotizacion-field">
          <label class="cotizacion-field__label" for="nc-rut">RUT</label>
          <input id="nc-rut" class="cotizacion-field__input" type="text" value="${escapeHtml(c.rut)}" placeholder="123456789" data-cotizacion-field="rut" />
        </div>
        <div class="cotizacion-field cotizacion-field--email">
          <label class="cotizacion-field__label" for="nc-email">E-mail</label>
          <input id="nc-email" class="cotizacion-field__input" type="email" value="${escapeHtml(c.email)}" placeholder="cliente@correo.cl" data-cotizacion-field="email" autocomplete="off" spellcheck="false" />
          <span class="cotizacion-field__hint" data-email-hint aria-live="polite"></span>
          <div class="email-autocomplete" data-email-autocomplete role="listbox" aria-label="Sugerencias de dominio"></div>
        </div>
        <div class="cotizacion-field">
          <label class="cotizacion-field__label" for="nc-comuna">Comuna</label>
          <input id="nc-comuna" class="cotizacion-field__input" type="text" value="${escapeHtml(c.comuna)}" placeholder="Padre Las Casas" data-cotizacion-field="comuna" />
        </div>
        <div class="cotizacion-field cotizacion-field--wide">
          <label class="cotizacion-field__label" for="nc-address">Dirección</label>
          <input id="nc-address" class="cotizacion-field__input" type="text" value="${escapeHtml(c.address)}" placeholder="Calle, número, depto · Comuna, Región, País" data-cotizacion-field="address" />
        </div>
        <div class="cotizacion-field cotizacion-field--wide">
          <label class="cotizacion-field__label" for="nc-message">Mensaje / observaciones</label>
          <textarea id="nc-message" class="cotizacion-field__input cotizacion-field__textarea" rows="3" placeholder="Notas para la cotización…" data-cotizacion-field="message">${escapeHtml(state.message)}</textarea>
        </div>
      </div>
    </section>`;
}

function renderStep2(state: EstadoWizard): string {
  const totalProd = totalProductos(state);
  const term = state.query.trim().toLowerCase();
  const productos = state.productos ?? [];

  const list = productos.filter((product) => {
    if (!term) return true;
    return `${product.name ?? ""} ${product.modelo ?? ""} ${product.categoria ?? product.category ?? ""}`
      .toLowerCase()
      .includes(term);
  });

  let catalogHtml: string;
  if (state.loading && state.productos === null) {
    catalogHtml = `
      <div class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
        <h3 class="empty-state__title">Cargando catálogo…</h3>
        <p class="empty-state__text">Consultando Firestore.</p>
      </div>`;
  } else if (productos.length === 0) {
    catalogHtml = `
      <div class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">${renderIcon("information", { size: 26 })}</div>
        <h3 class="empty-state__title">Catálogo vacío</h3>
        <p class="empty-state__text">No se encontraron productos en Firestore para cotizar.</p>
      </div>`;
  } else if (list.length === 0) {
    catalogHtml = `
      <div class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">${renderIcon("search", { size: 26 })}</div>
        <h3 class="empty-state__title">Sin resultados</h3>
        <p class="empty-state__text">No se encontraron productos para "${escapeHtml(state.query)}".</p>
      </div>`;
  } else {
    catalogHtml = `
      <ul class="card-list">
        ${list.map((product) => {
          const id = escapeHtml(product.id);
          const name = escapeHtml(product.name ?? product.modelo ?? "Sin nombre");
          const meta = escapeHtml(
            [product.modelo, product.categoria ?? product.category]
              .filter(Boolean)
              .join(" · ") || "—",
          );
          const precio = getPrecioLocal(product);
          const item = state.seleccion[product.id];
          const isSelected = Boolean(item);
          const isCollapsing = state.collapsing === product.id;
          const quantity = item?.quantity ?? 0;
          const colorId = item?.selectedColorId ?? DEFAULT_PRODUCT_COLOR_ID;
          const colorLabel = getProductColorLabel(colorId) ?? item?.selectedColor ?? "Color";

          return `
            <li class="card-list__item${isSelected ? " card-list__item--selected" : " card-list__item--tap"}${isCollapsing ? " card-list__item--closing" : ""}" data-cotizacion-id="${id}">
              ${
                isSelected
                  ? `
                <button type="button" class="card-list__btn card-list__btn--static" data-cotizacion-toggle="${id}" aria-label="Deseleccionar ${name}">
                  <div class="card-list__top">
                    <div class="card-list__title">${name}</div>
                    <span class="card-list__add card-list__add--remove" aria-hidden="true">${renderIcon("add", { size: 14 })}</span>
                  </div>
                  <div class="card-list__meta">${meta}</div>
                  <div class="card-list__price">${formatPrecio(precio)}</div>
                </button>
                <div class="card-list__expand">
                  <div class="qty-stepper">
                    <button type="button" class="qty-stepper__btn" data-cotizacion-dec="${id}" aria-label="Disminuir cantidad">−</button>
                    <span class="qty-stepper__value">${quantity}</span>
                    <button type="button" class="qty-stepper__btn" data-cotizacion-inc="${id}" aria-label="Aumentar cantidad">+</button>
                    <span class="qty-stepper__total">${formatPrecio(precio * quantity)}</span>
                  </div>
                  <div class="color-picker">
                    <div class="color-picker__dots" role="radiogroup" aria-label="Color de ${name}">
                      ${PRODUCT_COLORS.map((color) => {
                        const active = color.id === colorId;
                        return `
                          <button type="button" role="radio" aria-checked="${active}" aria-label="Color ${color.name}"
                            class="color-picker__dot${active ? " color-picker__dot--active" : ""}"
                            style="background-color: ${color.hex}"
                            data-cotizacion-color="${id}" data-color-id="${color.id}"></button>`;
                      }).join("")}
                    </div>
                    <span class="color-picker__label">${escapeHtml(colorLabel)}</span>
                  </div>
                </div>`
                  : `
                <button type="button" class="card-list__btn" data-cotizacion-toggle="${id}" aria-label="Seleccionar ${name}">
                  <div class="card-list__top">
                    <div class="card-list__title">${name}</div>
                    <span class="card-list__add" aria-hidden="true">${renderIcon("add", { size: 14 })}</span>
                  </div>
                  <div class="card-list__meta">${meta}</div>
                  <div class="card-list__price">${formatPrecio(precio)}</div>
                </button>`
              }
            </li>`;
        }).join("")}
      </ul>`;
  }

  return `
    <section class="cotizacion-form">
      <div class="productos-head">
        <h3 class="productos-head__title">Productos</h3>
        <span class="productos-head__count">${totalProd} seleccionado${totalProd === 1 ? "" : "s"}</span>
      </div>
      <div class="search-field">
        <span class="search-field__icon" aria-hidden="true">${renderIcon("search", { size: 17 })}</span>
        <input class="search-input" type="search" placeholder="Buscar productos…" value="${escapeHtml(state.query)}" data-cotizacion-search />
        <button type="button" class="search-field__clear" data-clear-cotizacion aria-label="Limpiar búsqueda" title="Limpiar">
          ${renderIcon("close", { size: 14 })}
        </button>
      </div>
      ${catalogHtml}
    </section>`;
}

function renderStep3(state: EstadoWizard): string {
  const items = seleccionItems(state);
  const total = totalProductos(state);

  const productRows = items
    .map(({ product, quantity, selectedColorId, selectedColor }) => {
      const name = escapeHtml(product.name ?? product.modelo ?? "Producto");
      const colorLabel = getProductColorLabel(selectedColorId) ?? selectedColor ?? "";
      const rowName = colorLabel ? `${name} · ${escapeHtml(colorLabel)}` : name;
      return `
        <div class="cotizacion-summary__row">
          <span>${rowName} × ${quantity}</span>
          <strong>${formatPrecio(getPrecioLocal(product) * quantity)}</strong>
        </div>`;
    })
    .join("");

  return `
    <section class="cotizacion-section">
      <h3 class="cotizacion-section__title">Revisar y enviar</h3>
      <div class="cotizacion-summary">
        <div class="cotizacion-summary__row">
          <span>Cliente</span>
          <strong>${escapeHtml(state.cliente.name || "—")}</strong>
        </div>
        <div class="cotizacion-summary__row">
          <span>RUT</span>
          <strong>${escapeHtml(state.cliente.rut || "—")}</strong>
        </div>
        <div class="cotizacion-summary__row">
          <span>E-mail</span>
          <strong>${escapeHtml(state.cliente.email || "—")}</strong>
        </div>
        <div class="cotizacion-summary__row">
          <span>Dirección</span>
          <strong>${escapeHtml(state.cliente.address || "—")}</strong>
        </div>
        <div class="cotizacion-summary__row">
          <span>Comuna</span>
          <strong>${escapeHtml(state.cliente.comuna || "—")}</strong>
        </div>
        <div class="cotizacion-summary__row">
          <span>Productos</span>
          <strong>${total} producto${total === 1 ? "" : "s"}</strong>
        </div>
        ${productRows}
        <div class="cotizacion-summary__row cotizacion-summary__row--total">
          <span>Total estimado</span>
          <strong>${formatPrecio(totalCotizacion(state))}</strong>
        </div>
        ${state.message.trim() ? `<div class="cotizacion-summary__obs"><span>Observaciones</span><p>${escapeHtml(state.message)}</p></div>` : ""}
      </div>
    </section>`;
}

function renderFooter(state: EstadoWizard): string {
  if (state.step === 1) {
    return `
      <button type="button" class="btn btn--primary" data-cotizacion-next>
        Siguiente →
      </button>`;
  }

  if (state.step === 2) {
    const total = totalProductos(state);
    return `
      <button type="button" class="btn btn--secondary" data-cotizacion-back>← Atrás</button>
      <div class="cotizacion-modal-total">
        <span class="cotizacion-modal-total__label">Total (${total} item${total === 1 ? "" : "s"})</span>
        <strong class="cotizacion-modal-total__value">${formatPrecio(totalCotizacion(state))}</strong>
      </div>
      <button type="button" class="btn btn--primary" data-cotizacion-next ${total === 0 ? "disabled" : ""}>
        Continuar →
      </button>`;
  }

  return `
    <button type="button" class="btn btn--secondary" data-cotizacion-back>← Atrás</button>
    <button type="button" class="btn btn--primary" data-cotizacion-generate ${state.generating ? "disabled" : ""}>
      ${renderIcon("fileText", { size: 16 })}
      ${state.generating
        ? editingId
          ? "Guardando cambios…"
          : "Generando PDF…"
        : editingId
          ? "Guardar y generar PDF"
          : "Generar PDF"}
    </button>`;
}

function colapsarYQuitar(state: EstadoWizard, productId: string): void {
  if (state.collapsing) return;
  state.collapsing = productId;

  const item = modal?.querySelector<HTMLElement>(
    `.card-list__item[data-cotizacion-id="${CSS.escape(productId)}"]`,
  );

  if (item) {
    item.classList.add("card-list__item--closing");
  } else {
    renderModal(state);
  }

  window.setTimeout(() => {
    delete state.seleccion[productId];
    state.collapsing = null;
    renderModal(state);
  }, 320);
}

function marcarCampoError(field: string): void {
  const wrap = modal?.querySelector<HTMLElement>(
    `[data-cotizacion-field-wrap="${field}"]`,
  );
  wrap?.classList.add("cotizacion-field--error");
}

function limpiarCampoError(field: string): void {
  const wrap = modal?.querySelector<HTMLElement>(
    `[data-cotizacion-field-wrap="${field}"]`,
  );
  wrap?.classList.remove("cotizacion-field--error");
}

function avanzarPaso(state: EstadoWizard): void {
  if (state.step === 1 && !state.cliente.name.trim()) {
    marcarCampoError("name");
    const nameInput = modal?.querySelector<HTMLInputElement>("#nc-name");
    nameInput?.focus();
    showToast({
      title: "Falta el nombre del cliente",
      message: "Completa el nombre o razón social para continuar.",
      tone: "warning",
    });
    return;
  }
  if (state.step === 2 && Object.keys(state.seleccion).length === 0) {
    showToast({
      title: "Selecciona productos",
      message: "Agrega al menos un producto para continuar.",
      tone: "warning",
    });
    return;
  }
  state.step = (state.step + 1) as EstadoWizard["step"];
  renderModal(state);
}

function actualizarClearCotizacion(root: HTMLElement | null, query: string): void {
  const clearBtn = root?.querySelector<HTMLButtonElement>("[data-clear-cotizacion]");
  if (!clearBtn) return;
  clearBtn.classList.toggle("is-visible", query.length > 0);
}

function bindEvents(state: EstadoWizard): void {
  if (!modal) return;

  modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-cotizacion-field]")
    .forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.cotizacionField as keyof ClienteDatos | "message";
        if (field === "phone") {
          const caret = input.selectionStart ?? input.value.length;
          const digitsBefore = countDigitsBefore(input.value, caret);
          const result = formatPhoneNumber(input.value);
          input.value = result.formatted;
          state.cliente.phone = result.formatted;
          const hint = modal?.querySelector<HTMLElement>("[data-phone-hint]");
          if (hint) {
            hint.textContent = result.country
              ? `${result.country.flag} ${result.country.name}`
              : "";
            hint.classList.toggle("is-visible", Boolean(result.country));
          }
          const next = caretAfterDigits(input.value, digitsBefore);
          input.setSelectionRange(next, next);
          return;
        }
        if (field === "email") {
          state.cliente.email = input.value;
          actualizarAutocompleteEmail(state, input as HTMLInputElement);
          return;
        }
        if (field === "message") {
          state.message = input.value;
        } else {
          state.cliente[field] = input.value;
        }

        if (field === "name" && input.value.trim()) {
          limpiarCampoError("name");
        }

        scheduleSave(state);
      });
    });

  const emailInput = modal.querySelector<HTMLInputElement>("#nc-email");
  if (emailInput) {
    emailInput.addEventListener("keydown", (event) => {
      const box = modal?.querySelector<HTMLElement>("[data-email-autocomplete]");
      const isOpen = Boolean(box?.classList.contains("is-open"));

      if (event.key === "Escape") {
        ocultarAutocompleteEmail();
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        const value = emailInput.value;
        const hasAt = value.includes("@");

        if (!hasAt && value.trim()) {
          event.preventDefault();
          event.stopPropagation();
          const full = `${value.trim()}@gmail.com`;
          emailInput.value = full;
          state.cliente.email = full;
          emailInput.setSelectionRange(full.length, full.length);
          ocultarAutocompleteEmail();
          return;
        }

        const first = box?.querySelector<HTMLButtonElement>("[data-email-domain]");
        if (isOpen && first) {
          event.preventDefault();
          event.stopPropagation();
          const domain = first.dataset.emailDomain;
          if (domain) aplicarSugerenciaEmail(state, emailInput, domain);
        }
      }
    });
    emailInput.addEventListener("blur", () => {
      window.setTimeout(() => {
        ocultarAutocompleteEmail();
        const value = emailInput.value;
        if (!value.includes("@") && value.trim()) {
          const full = `${value.trim()}@gmail.com`;
          emailInput.value = full;
          state.cliente.email = full;
        }
      }, 150);
    });
  }

  modal.querySelector<HTMLInputElement>("[data-cotizacion-search]")?.addEventListener("input", (event) => {
    state.query = (event.target as HTMLInputElement).value;
    const bodyEl = modal?.querySelector<HTMLElement>(".cotizacion-modal__body");
    if (!bodyEl) return;
    bodyEl.innerHTML = renderStep2(state);
    bindEvents(state);
    const search = modal?.querySelector<HTMLInputElement>("[data-cotizacion-search]");
    if (search) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
    actualizarClearCotizacion(modal, state.query);
  });

  modal.querySelector<HTMLButtonElement>("[data-clear-cotizacion]")?.addEventListener("click", () => {
    state.query = "";
    const bodyEl = modal?.querySelector<HTMLElement>(".cotizacion-modal__body");
    if (!bodyEl) return;
    bodyEl.innerHTML = renderStep2(state);
    bindEvents(state);
    const search = modal?.querySelector<HTMLInputElement>("[data-cotizacion-search]");
    if (search) {
      search.focus();
    }
    actualizarClearCotizacion(modal, "");
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-cotizacion-inc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cotizacionInc;
      if (!id) return;
      const item = state.seleccion[id];
      if (item) {
        item.quantity += 1;
      } else {
        state.seleccion[id] = defaultItem();
      }
      renderModal(state);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-cotizacion-dec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cotizacionDec;
      if (!id) return;
      const item = state.seleccion[id];
      if (!item) return;
      const next = item.quantity - 1;
      if (next <= 0) {
        colapsarYQuitar(state, id);
      } else {
        item.quantity = next;
        renderModal(state);
      }
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-cotizacion-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cotizacionToggle;
      if (!id) return;
      const item = state.seleccion[id];
      if (item) {
        colapsarYQuitar(state, id);
      } else {
        state.seleccion[id] = defaultItem();
        renderModal(state);
      }
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-cotizacion-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cotizacionColor;
      const colorId = btn.dataset.colorId;
      if (!id || !colorId) return;
      const item = state.seleccion[id];
      if (!item) return;
      const color = getProductColorById(colorId);
      item.selectedColorId = colorId;
      item.selectedColor = color?.name ?? item.selectedColor;
      renderModal(state);
    });
  });

  modal.querySelector<HTMLButtonElement>("[data-cotizacion-back]")?.addEventListener("click", () => {
    state.step = (state.step - 1) as EstadoWizard["step"];
    renderModal(state);
  });

  modal.querySelector<HTMLButtonElement>("[data-cotizacion-next]")?.addEventListener("click", () => {
    avanzarPaso(state);
  });

  modal.querySelector<HTMLButtonElement>("[data-cotizacion-generate]")?.addEventListener("click", () => {
    void generar(state);
  });
}

function ocultarAutocompleteEmail(): void {
  const box = modal?.querySelector<HTMLElement>("[data-email-autocomplete]");
  if (box) {
    box.innerHTML = "";
    box.classList.remove("is-open");
  }
  modal?.querySelector<HTMLElement>("[data-email-hint]")?.classList.remove("is-visible");
}

function aplicarSugerenciaEmail(
  state: EstadoWizard,
  input: HTMLInputElement,
  domain: string,
): void {
  const value = input.value;
  const at = value.lastIndexOf("@");
  if (at === -1) return;
  const local = emailLocalPart(value);
  const full = `${local}@${domain}`;
  input.value = full;
  state.cliente.email = full;
  input.setSelectionRange(full.length, full.length);
  ocultarAutocompleteEmail();
  input.focus();
}

function actualizarAutocompleteEmail(
  state: EstadoWizard,
  input: HTMLInputElement,
): void {
  if (!modal) return;
  const box = modal.querySelector<HTMLElement>("[data-email-autocomplete]");
  const hint = modal.querySelector<HTMLElement>("[data-email-hint]");
  if (!box) return;

  const value = input.value;

  if (!needsEmailDomainCompletion(value)) {
    ocultarAutocompleteEmail();
    return;
  }

  const domains = suggestEmailDomains(value);
  if (domains.length === 0) {
    ocultarAutocompleteEmail();
    return;
  }

  const at = value.lastIndexOf("@");
  const typed = at >= 0 ? value.slice(at + 1).toLowerCase() : "";
  const typedNormalized = typed.replace(/[^a-z0-9]/g, "");

  // Si el usuario ya escribió gran parte del dominio, completar solo el más cercano
  if (typed.length >= 2 && domains.length > 1 && typedNormalized.length >= 2) {
    const exact = domains.filter((domain) =>
      domain.startsWith(typedNormalized),
    );
    if (exact.length === 1 && hint) {
      hint.textContent = `¿${exact[0]}?`;
      hint.classList.add("is-visible");
    } else if (hint) {
      hint.classList.remove("is-visible");
    }
  } else if (hint) {
    hint.classList.remove("is-visible");
  }

  box.innerHTML = domains
    .map(
      (domain) => `
        <button type="button" class="email-autocomplete__item" role="option" data-email-domain="${escapeHtml(domain)}">
          <span class="email-autocomplete__at" aria-hidden="true">@</span>
          ${escapeHtml(domain)}
        </button>`,
    )
    .join("");

  box.classList.add("is-open");

  box.querySelectorAll<HTMLButtonElement>("[data-email-domain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const domain = btn.dataset.emailDomain;
      if (domain) aplicarSugerenciaEmail(state, input, domain);
    });
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const domain = btn.dataset.emailDomain;
      if (domain) aplicarSugerenciaEmail(state, input, domain);
    });
  });
}

function renderModal(state: EstadoWizard): void {
  if (!modal) return;

  const body = modal.querySelector<HTMLElement>(".cotizacion-modal__body");
  const footer = modal.querySelector<HTMLElement>(".cotizacion-modal__footer");
  const stepsEl = modal.querySelector<HTMLElement>(".cotizacion-modal__steps");
  const subtitle = modal.querySelector<HTMLElement>(".cotizacion-modal__subtitle");
  if (!body || !footer || !stepsEl) return;

  const stepChanged = lastStep !== state.step;
  lastStep = state.step;
  if (stepChanged) {
    stepsEl.classList.remove("is-animating");
    void stepsEl.offsetWidth;
    stepsEl.classList.add("is-animating");
    stepsEl.innerHTML = stepIndicator(state.step);
  }
  if (subtitle) {
    subtitle.textContent = `Paso ${state.step} de 3 · ${STEPS[state.step - 1]}`;
  }

  body.innerHTML =
    state.step === 1 ? renderStep1(state)
    : state.step === 2 ? renderStep2(state)
    : renderStep3(state);

  footer.innerHTML = renderFooter(state);

  bindEvents(state);
  actualizarClearCotizacion(modal, state.query);
  scheduleSave(state);

  if (state.step === 1) {
    const phoneInput = modal.querySelector<HTMLInputElement>("#nc-phone");
    const hint = modal.querySelector<HTMLElement>("[data-phone-hint]");
    if (phoneInput && hint) {
      const result = formatPhoneNumber(phoneInput.value);
      hint.textContent = result.country
        ? `${result.country.flag} ${result.country.name}`
        : "";
      hint.classList.toggle("is-visible", Boolean(result.country));
    }
    const emailInput = modal.querySelector<HTMLInputElement>("#nc-email");
    if (emailInput) {
      actualizarAutocompleteEmail(state, emailInput);
    }
  }
}

async function generar(state: EstadoWizard): Promise<void> {
  if (state.generating) return;
  state.generating = true;
  renderModal(state);

  try {
    const items = seleccionItems(state);
    const direccionCompleta = state.cliente.address.trim();
    const destino = direccionCompleta || "Por acordar con el cliente";

    const productsPayload = items.map(({ product, quantity, selectedColorId, selectedColor }) => ({
      productId: product.id,
      name: product.name ?? product.modelo ?? "Producto",
      quantity,
      unitPrice: getPrecioLocal(product),
      ...(selectedColorId ? { selectedColorId } : {}),
      ...(selectedColor ? { selectedColor } : {}),
    }));

    const common = {
      clientName: state.cliente.name.trim(),
      clientPhone: state.cliente.phone.trim(),
      clientRut: state.cliente.rut.trim(),
      clientEmail: state.cliente.email.trim(),
      clientComuna: state.cliente.comuna.trim(),
      clientAddress: direccionCompleta,
      message: state.message.trim(),
      shipping: {
        origin: ORIGEN_FICA,
        originZip: "4780000",
        destination: destino,
      },
      products: productsPayload,
    };

    // Sin conexión: la cotización se guarda en la cola offline durable y se
    // enviará automáticamente cuando se recupere la red.
    if (getNetworkState() === "offline") {
      if (editingId && editingItem) {
        const estado = String(editingItem.estado ?? "pendiente");
        await enqueueOp("update_cotizacion", {
          id: editingId,
          campos: {
            ...common,
            estado,
            enOT: Boolean(editingItem.enOT),
          },
        });
      } else {
        const quoteId = `COT-${Date.now().toString().slice(-6)}`;
        await enqueueOp("registrar_ot", { payload: { id: quoteId, ...common } });
      }

      void clearDraft(DRAFT_KIND);
      editingId = null;
      editingItem = null;
      closeNuevaCotizacion();
      showToast({
        title: "Cotización guardada localmente",
        message: "Sin conexión: se enviará a la web automáticamente al reconectar.",
        tone: "info",
        icon: "fileText",
        durationMs: 6000,
      });
      return;
    }

    let item: SolicitudRemota;
    let editando = false;

    if (editingId && editingItem) {
      // Edición in-place: PATCH al mismo documento (no se crea una copia).
      editando = true;
      invalidarCotizacionPdf(editingId);
      invalidarOrdenTrabajoPdf(editingId);
      const estado = String(editingItem.estado ?? "pendiente");
      const update = await actualizarCotizacionRemota(editingId, {
        ...common,
        estado,
        enOT: Boolean(editingItem.enOT),
      });

      if (!update.ok) {
        state.generating = false;
        renderModal(state);
        showToast({
          title: "Error al guardar cambios",
          message: update.error ?? "No se pudo actualizar la cotización.",
          tone: "error",
        });
        return;
      }

      item = {
        id: editingId,
        ...common,
        estado,
        enOT: Boolean(editingItem.enOT),
        createdAt: String(
          editingItem.createdAt ?? new Date().toISOString(),
        ),
      };
    } else {
      const quoteId = `COT-${Date.now().toString().slice(-6)}`;
      const payload = { id: quoteId, ...common };
      const registro = await registrarOrdenTrabajo(payload);

      item = {
        id: registro.data?.id ?? quoteId,
        ...common,
        estado: "pendiente",
        createdAt: new Date().toISOString(),
      };
    }

    const pdf = await generarCotizacionPdf(item);
    void refreshSolicitudes();

    showToast({
      title: editando ? "Cotización actualizada" : "Cotización generada",
      message: editando
        ? `La cotización ${item.id} se actualizó. Para ver el PDF, haz clic en la fila de la cotización.`
        : `La OT ${item.id} quedó registrada. Para ver el PDF, haz clic en la fila de la cotización.`,
      tone: "success",
      icon: "fileText",
      durationMs: 8000,
      actions: [
        { label: "Ver PDF", onClick: () => openPdfViewer(pdf), primary: true },
        { label: "Descargar PDF", onClick: () => descargarPdf(pdf) },
      ],
    });

    editingId = null;
    editingItem = null;
    void clearDraft(DRAFT_KIND);
    closeNuevaCotizacion();
  } catch (error) {
    console.error("Error al generar cotización:", error);
    showToast({
      title: "Error al generar el PDF",
      message: "No se pudo crear la cotización.",
      tone: "error",
    });
    state.generating = false;
    renderModal(state);
  }
}

export function openNuevaCotizacion(editar?: SolicitudRemota): void {
  closeNuevaCotizacion();

  editingId = editar?.id ?? null;
  editingItem = editar ?? null;

  const state = cleanState();

  if (editar) {
    state.cliente = {
      name: String(editar.clientName ?? ""),
      phone: String(editar.clientPhone ?? ""),
      rut: String(editar.clientRut ?? ""),
      email: String(editar.clientEmail ?? ""),
      comuna: String(editar.clientComuna ?? ""),
      address: String(editar.clientAddress ?? ""),
    };
    state.message = String(editar.message ?? "");

    if (Array.isArray(editar.products)) {
      for (const product of editar.products) {
        if (!product || typeof product !== "object") continue;
        const rec = product as Record<string, unknown>;
        const productId = String(rec.productId ?? rec.id ?? "");
        const qty = Math.max(1, Number(rec.quantity ?? 1) || 1);
        if (productId) {
          state.seleccion[productId] = defaultItem(
            typeof rec.selectedColorId === "string" ? rec.selectedColorId : null,
            typeof rec.selectedColor === "string" ? rec.selectedColor : null,
          );
          state.seleccion[productId].quantity = qty;
        }
      }
    }
  }

  modal = document.createElement("div");
  modal.className = "cotizacion-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", editingId ? "Editar cotización" : "Nueva cotización");

  modal.innerHTML = `
    <div class="cotizacion-modal__panel">
      <header class="cotizacion-modal__header">
        <div class="cotizacion-modal__header-info">
          <span class="cotizacion-modal__icon" aria-hidden="true">${renderIcon("fileText", { size: 20 })}</span>
          <div>
            <div class="cotizacion-modal__title">${editingId ? "Editar cotización" : "Nueva cotización"}</div>
            <div class="cotizacion-modal__subtitle">Paso 1 de 3 · Datos</div>
          </div>
        </div>
        <button type="button" class="cotizacion-modal__close-btn" data-cotizacion-close aria-label="Cerrar" title="Cerrar">
          ${renderIcon("close", { size: 26 })}
        </button>
      </header>
      <div class="cotizacion-modal__steps"></div>
      <div class="cotizacion-modal__body"></div>
      <footer class="cotizacion-modal__footer"></footer>
    </div>`;

  const solicitarDescarte = async (): Promise<boolean> => {
    if (!hasContent(state)) return true;

    const confirmado = await showConfirmDialog({
      title: "¿Descartar la cotización en curso?",
      message: "Se perderán los datos que has introducido en este formulario.",
      confirmText: "Descartar",
      cancelText: "Continuar editando",
      tone: "danger",
    });

    if (confirmado) {
      void clearDraft(DRAFT_KIND);
    }

    return confirmado;
  };

  modal.querySelector<HTMLButtonElement>("[data-cotizacion-close]")?.addEventListener("click", async () => {
    if (await solicitarDescarte()) {
      closeNuevaCotizacion();
    }
  });

  modal.addEventListener("click", async (event) => {
    if (event.target === modal && !state.generating) {
      if (await solicitarDescarte()) {
        closeNuevaCotizacion();
      }
    }
  });

  const onKeyDown = async (event: KeyboardEvent): Promise<void> => {
    if (event.key === "Escape" && !state.generating) {
      if (await solicitarDescarte()) {
        document.removeEventListener("keydown", onKeyDown);
        closeNuevaCotizacion();
      }
      return;
    }

    // Enter para avanzar de paso / generar (fuera de inputs de texto)
    if (event.key === "Enter" && !state.generating) {
      const target = event.target as HTMLElement | null;
      const isTextInput = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );

      // En paso 1, Enter dentro de un input avanza (comportamiento de formulario).
      if (state.step === 1 && isTextInput) {
        const isTextarea = Boolean(target?.closest("textarea"));
        if (!isTextarea) {
          event.preventDefault();
          avanzarPaso(state);
        }
        return;
      }

      if (isTextInput) return;

      event.preventDefault();
      if (state.step === 1 || state.step === 2) {
        avanzarPaso(state);
      } else if (state.step === 3) {
        const generate = modal?.querySelector<HTMLButtonElement>("[data-cotizacion-generate]");
        if (generate && !generate.disabled) {
          generate.click();
        }
      }
    }
  };
  document.addEventListener("keydown", onKeyDown);

  document.body.classList.add("modal-open");
  document.body.appendChild(modal);
  renderModal(state);

  // Borrador guardado de una sesión anterior (solo cotizaciones nuevas).
  if (!editar) {
    void (async () => {
      const draft = await getDraft<BorradorCotizacion>(DRAFT_KIND);
      if (!draft || !draft.data) return;

      const restaurar = await showConfirmDialog({
        title: "Borrador encontrado",
        message: `Hay una cotización sin terminar guardada el ${new Date(draft.updatedAt).toLocaleString()}. ¿Quieres reanudarla?`,
        confirmText: "Reanudar",
        cancelText: "Descartar",
        tone: "info",
        icon: "fileText",
      });

      if (restaurar) {
        aplicarBorrador(state, draft.data);
      } else {
        void clearDraft(DRAFT_KIND);
      }
      renderModal(state);
    })();
  }

  void loadCatalogo()
    .then((productos) => {
      state.productos = productos;
      state.loading = false;
      renderModal(state);
    })
    .catch((error) => {
      console.error("Error al cargar el catálogo:", error);
      state.productos = [];
      state.loading = false;
      renderModal(state);
      showToast({
        title: "No se pudo cargar el catálogo",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    });
}

export function closeNuevaCotizacion(): void {
  if (!modal) return;
  modal.remove();
  modal = null;
  editingId = null;
  editingItem = null;
  document.body.classList.remove("modal-open");
}

export function initNuevaCotizacion(): void {
  document
    .querySelector<HTMLButtonElement>('[data-action="nueva-cotizacion"]')
    ?.addEventListener("click", () => openNuevaCotizacion());
}
