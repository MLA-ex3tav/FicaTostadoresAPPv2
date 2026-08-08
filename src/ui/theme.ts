export type Theme = "light" | "dark";

const STORAGE_KEY = "fica-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }

  return systemTheme();
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  root.setAttribute("data-theme", theme);

  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }

  updateToggleUi(theme);

  window.setTimeout(() => {
    root.classList.remove("theme-transition");
  }, 320);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

function updateToggleUi(theme: Theme): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  const label =
    theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
  btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  btn.dataset.theme = theme;
}

export function initTheme(): void {
  const theme = getTheme();
  document.documentElement.setAttribute("data-theme", theme);
  updateToggleUi(theme);

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    toggleTheme();
  });
}
