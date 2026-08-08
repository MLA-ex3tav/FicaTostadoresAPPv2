import { renderIcon, type IconName } from "./icons";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "warning" | "info";
  icon?: IconName;
}

/**
 * Muestra un diálogo de confirmación personalizado de alta calidad visual.
 */
export function showConfirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-dialog";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", options.title);

    const tone = options.tone ?? "danger";
    const iconName: IconName = options.icon ?? (tone === "danger" ? "close" : "information");
    const confirmText = options.confirmText ?? "Confirmar";
    const cancelText = options.cancelText ?? "Cancelar";

    overlay.innerHTML = `
      <div class="confirm-dialog__panel confirm-dialog__panel--${tone}">
        <div class="confirm-dialog__icon-wrap">
          ${renderIcon(iconName, { size: 24 })}
        </div>
        <div class="confirm-dialog__content">
          <h3 class="confirm-dialog__title">${options.title}</h3>
          ${options.message ? `<p class="confirm-dialog__message">${options.message}</p>` : ""}
        </div>
        <div class="confirm-dialog__actions">
          <button type="button" class="btn btn--secondary" data-confirm-cancel>${cancelText}</button>
          <button type="button" class="btn btn--${tone === "danger" ? "danger" : "primary"}" data-confirm-ok>${confirmText}</button>
        </div>
      </div>
    `;

    let resolved = false;
    const close = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      overlay.classList.add("confirm-dialog--closing");
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 150);
    };

    overlay.querySelector("[data-confirm-ok]")?.addEventListener("click", () => close(true));
    overlay.querySelector("[data-confirm-cancel]")?.addEventListener("click", () => close(false));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        document.removeEventListener("keydown", handleKeyDown);
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        document.removeEventListener("keydown", handleKeyDown);
        close(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    document.body.appendChild(overlay);
  });
}
