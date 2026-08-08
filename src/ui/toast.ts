import { renderIcon, type IconName } from "./icons";

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ToastOptions {
  title: string;
  message?: string;
  icon?: IconName;
  tone?: "success" | "error" | "info" | "warning";
  /** ms antes de autocerrar; 0 = persistente. Default 10000. */
  durationMs?: number;
  actions?: ToastAction[];
}

const CONTAINER_ID = "toast-container";

function ensureContainer(): HTMLElement {
  let container = document.getElementById(CONTAINER_ID);

  if (!container) {
    container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  return container;
}

export function showToast(options: ToastOptions): () => void {
  const container = ensureContainer();
  const tone = options.tone ?? "info";

  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.setAttribute("role", "status");

  const iconHtml = options.icon
    ? `<span class="toast__icon">${renderIcon(options.icon, { size: 20 })}</span>`
    : "";

  const actionsHtml = (options.actions ?? [])
    .map(
      (action, index) =>
        `<button type="button" class="btn btn--sm ${action.primary ? "btn--primary" : "btn--secondary"}" data-toast-action="${index}">${action.label}</button>`,
    )
    .join("");

  toast.innerHTML = `
    ${iconHtml}
    <div class="toast__body">
      <div class="toast__title"></div>
      ${options.message ? `<div class="toast__message"></div>` : ""}
      ${actionsHtml ? `<div class="toast__actions">${actionsHtml}</div>` : ""}
    </div>
    <button type="button" class="toast__close" aria-label="Cerrar notificación">×</button>
  `;

  toast.querySelector(".toast__title")!.textContent = options.title;
  const messageEl = toast.querySelector(".toast__message");
  if (messageEl && options.message) {
    messageEl.textContent = options.message;
  }

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    toast.classList.add("toast--out");
    window.setTimeout(() => toast.remove(), 200);
  };

  toast.querySelector(".toast__close")?.addEventListener("click", close);

  toast.querySelectorAll<HTMLButtonElement>("[data-toast-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.toastAction);
      const action = options.actions?.[index];
      action?.onClick();
      close();
    });
  });

  const duration = options.durationMs ?? 10_000;
  if (duration > 0) {
    window.setTimeout(close, duration);
  }

  container.appendChild(toast);
  return close;
}
