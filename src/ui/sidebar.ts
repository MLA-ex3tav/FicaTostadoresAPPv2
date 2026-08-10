export type ViewId =
  | "cotizaciones"
  | "ot"
  | "historial"
  | "clientes"
  | "productos"
  | "soporte"
  | "conexiones";

type NavigateHandler = (viewId: ViewId) => void;

let onViewChange: NavigateHandler = () => {};

const SIDEBAR_KEY = "fica-sidebar-collapsed";export function onNavigate(callback: NavigateHandler): void {
  onViewChange = callback;
}

export function navigateTo(viewId: ViewId): void {
  document.querySelectorAll<HTMLElement>(".view").forEach((view) => {
    view.classList.toggle("view--active", view.dataset.view === viewId);
  });

  document.querySelectorAll<HTMLElement>(".nav-item").forEach((item) => {
    item.classList.toggle("nav-item--active", item.dataset.view === viewId);
  });

  onViewChange(viewId);
}

export function setNavBadge(viewId: ViewId, count: number): void {
  const badge = document.getElementById(`nav-badge-${viewId}`);
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

export function closeMobileSidebar(): void {
  document.getElementById("app-sidebar")?.classList.remove("sidebar--open");
  document.getElementById("sidebar-overlay")?.classList.remove("sidebar-overlay--open");
}

export function openMobileSidebar(): void {
  document.getElementById("app-sidebar")?.classList.add("sidebar--open");
  document.getElementById("sidebar-overlay")?.classList.add("sidebar-overlay--open");
}

/* ── Sidebar collapse/expand ── */

function isSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 768px)").matches;
}

function setSidebarCollapsed(collapsed: boolean): void {
  const sidebar = document.getElementById("app-sidebar");
  const shell = document.querySelector<HTMLElement>(".app-shell");
  if (!sidebar || !shell) return;

  if (collapsed) {
    sidebar.classList.add("sidebar--collapsed");
    shell.classList.add("app-shell--sidebar-collapsed");
  } else {
    sidebar.classList.remove("sidebar--collapsed");
    shell.classList.remove("app-shell--sidebar-collapsed");
  }

  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

function toggleSidebarCollapse(): void {
  const sidebar = document.getElementById("app-sidebar");
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.contains("sidebar--collapsed");
  setSidebarCollapsed(!isCollapsed);
}

export function initSidebar(): void {
  const handleNavClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest(".nav-item");
    if (!target || !(target instanceof HTMLElement)) return;

    const viewId = target.dataset.view as ViewId | undefined;
    if (viewId) {
      navigateTo(viewId);
      closeMobileSidebar();
    }
  };

  document.getElementById("sidebar-nav")?.addEventListener("click", handleNavClick);
  document.getElementById("bottom-nav")?.addEventListener("click", handleNavClick);

  const toggleMobileSidebar = () => {
    const sidebar = document.getElementById("app-sidebar");
    if (sidebar?.classList.contains("sidebar--open")) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  };

  document.getElementById("mobile-menu-toggle")?.addEventListener("click", toggleMobileSidebar);
  document.getElementById("bottom-nav-more-btn")?.addEventListener("click", toggleMobileSidebar);
  document.getElementById("sidebar-overlay")?.addEventListener("click", closeMobileSidebar);

  // Collapse toggle (desktop)
  document.getElementById("sidebar-collapse-toggle")?.addEventListener("click", toggleSidebarCollapse);

  // Restore collapsed state from localStorage (solo en desktop)
  if (!isMobileViewport() && isSidebarCollapsed()) {
    setSidebarCollapsed(true);
  }
}
