let loaderEl: HTMLElement | null = null;
let refCount = 0;

let topLoaderEl: HTMLElement | null = null;
let topRefCount = 0;

function escapeMsg(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

/** Muestra un overlay con spinner centrado y un mensaje opcional. */
export function mostrarLoader(mensaje?: string): void {
  refCount += 1;

  if (loaderEl) {
    if (mensaje) {
      const msgEl = loaderEl.querySelector<HTMLElement>("[data-loader-msg]");
      if (msgEl) msgEl.textContent = mensaje;
    }
    return;
  }

  loaderEl = document.createElement("div");
  loaderEl.className = "app-loader";
  loaderEl.setAttribute("role", "status");
  loaderEl.setAttribute("aria-live", "polite");
  loaderEl.innerHTML = `
    <div class="app-loader__box">
      <span class="app-loader__spinner" aria-hidden="true"></span>
      <span class="app-loader__msg" data-loader-msg>${escapeMsg(mensaje ?? "Cargando…")}</span>
    </div>`;

  document.body.appendChild(loaderEl);
}

/** Oculta el overlay (solo si no hay más loaders activos). */
export function ocultarLoader(): void {
  refCount = Math.max(0, refCount - 1);

  if (refCount === 0 && loaderEl) {
    loaderEl.remove();
    loaderEl = null;
  }
}

/**
 * Ejecuta una promesa mostrando el loader solo si tarda más de ~200 ms
 * (en un PC rápido la operación termina al instante y no se muestra nada).
 */
export async function conLoader<T>(
  promise: Promise<T> | (() => Promise<T>),
  mensaje?: string,
): Promise<T> {
  let shown = false;
  const timer = window.setTimeout(() => {
    mostrarLoader(mensaje);
    shown = true;
  }, 200);

  try {
    return await (typeof promise === "function" ? promise() : promise);
  } finally {
    window.clearTimeout(timer);
    if (shown) {
      ocultarLoader();
    }
  }
}

/** Muestra una barra fina arriba indicando que se están actualizando datos. */
export function mostrarTopLoader(): void {
  topRefCount += 1;
  if (topLoaderEl) return;

  topLoaderEl = document.createElement("div");
  topLoaderEl.className = "top-loader";
  topLoaderEl.setAttribute("role", "status");
  topLoaderEl.setAttribute("aria-label", "Actualizando datos");
  topLoaderEl.innerHTML =
    '<span class="top-loader__bar" aria-hidden="true"></span>';

  document.body.appendChild(topLoaderEl);
  void topLoaderEl.offsetWidth;
  topLoaderEl.classList.add("is-visible");
}

/** Oculta la barra superior (solo si no hay más refrescos activos). */
export function ocultarTopLoader(): void {
  topRefCount = Math.max(0, topRefCount - 1);

  if (topRefCount === 0 && topLoaderEl) {
    topLoaderEl.classList.remove("is-visible");
    const el = topLoaderEl;
    topLoaderEl = null;
    window.setTimeout(() => el.remove(), 200);
  }
}

/** Ejecuta una promesa mostrando la barra superior mientras dure. */
export async function conTopLoader<T>(
  promise: Promise<T> | (() => Promise<T>),
): Promise<T> {
  mostrarTopLoader();
  try {
    return await (typeof promise === "function" ? promise() : promise);
  } finally {
    ocultarTopLoader();
  }
}
