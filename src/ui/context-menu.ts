import { renderIcon, type IconName } from "./icons";

export interface ContextMenuItem {
  label?: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  /** Si es true, la entrada se convierte en un separador (ignora el resto). */
  separator?: boolean;
  onClick?: () => void;
}

interface OpenMenuOptions {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

type MenuElement = HTMLElement & {
  __dismissCleanup?: () => void;
};

let menuEl: MenuElement | null = null;

export function closeContextMenu(): void {
  if (!menuEl) return;
  if (typeof menuEl.__dismissCleanup === "function") {
    menuEl.__dismissCleanup();
  }
  menuEl.remove();
  menuEl = null;
}

/**
 * Abre un menú contextual personalizado en la posición del puntero.
 * Cierra con click fuera, Escape, resize o scroll fuera del menú.
 */
export function openContextMenu(options: OpenMenuOptions): void {
  closeContextMenu();

  const { x, y, items } = options;

  const el = document.createElement("div");
  el.className = "context-menu";
  el.setAttribute("role", "menu");
  el.setAttribute("aria-label", "Acciones");

  el.innerHTML = items
    .map((item, index) => {
      if (item.separator) {
        return `<div class="context-menu__separator" role="separator"></div>`;
      }

      return `
        <button
          type="button"
          class="context-menu__item${item.danger ? " context-menu__item--danger" : ""}"
          data-action="${index}"
          role="menuitem"
          ${item.disabled ? "disabled" : ""}
        >
          ${
            item.icon
              ? `<span class="context-menu__icon" aria-hidden="true">${renderIcon(item.icon, { size: 16 })}</span>`
              : ""
          }
          <span class="context-menu__label">${String(item.label).replace(/</g, "&lt;")}</span>
        </button>`;
    })
    .join("");

  el.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-action]",
    );
    if (!btn || btn.disabled) return;

    const index = Number(btn.dataset.action);
    const item = items[index];
    closeContextMenu();
    if (item) {
      item.onClick?.();
    }
  });

  document.body.appendChild(el);
  menuEl = el as MenuElement;

  // Posiciona dentro del viewport tras renderizar sus dimensiones.
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;

    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }

    el.style.left = `${Math.max(margin, left)}px`;
    el.style.top = `${Math.max(margin, top)}px`;
    el.classList.add("context-menu--open");
  });

  const onPointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Node) || !el.contains(event.target)) {
      closeContextMenu();
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeContextMenu();
  };
  const onResize = (): void => closeContextMenu();

  (el as MenuElement).__dismissCleanup = () => {
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
  };

  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
}

/** Hook global: cierra el menú si está abierto (útil en navegación de vista). */
export function dismissContextMenu(): void {
  closeContextMenu();
}