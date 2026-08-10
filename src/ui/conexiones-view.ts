import { getConfig } from "../lib/config";
import {
  initialChecks,
  runConnectionChecks,
  summarizeChecks,
  type CheckStatus,
  type ConnectionCheck,
  type OverallStatus,
} from "../lib/connections";
import { getNetworkState, onNetworkChange } from "../lib/network";
import { invoke } from "../lib/runtime";
import { renderIcon, mountIcons } from "./icons";
import { checkAppUpdates } from "../services/updater";
import { syncNow } from "../services/queue-executors";
import { showToast } from "./toast";
import { conLoader } from "./loader";

const PANEL_ID = "conexiones-list";

let running = false;
let lastRunAt: number | null = null;
let lastChecks: ConnectionCheck[] | null = null;

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "Operativo";
    case "warn":
      return "Atención";
    case "error":
      return "Error";
    case "checking":
      return "Comprobando…";
  }
}

function statusPillClass(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "status-pill status-pill--done";
    case "warn":
      return "status-pill status-pill--pending";
    case "error":
      return "status-pill status-pill--error";
    case "checking":
      return "status-pill status-pill--progress";
  }
}

function renderCheckRow(check: ConnectionCheck): string {
  const latency =
    check.latencyMs !== null
      ? `<span class="conn-latency">${check.latencyMs} ms</span>`
      : "";

  return `
    <div class="conn-row">
      <span class="conn-row__icon" aria-hidden="true">${renderIcon(check.icon, { size: 20 })}</span>
      <div class="conn-row__body">
        <span class="conn-row__label">${escapeHtml(check.label)}</span>
        <span class="conn-row__detail">${escapeHtml(check.detail)}</span>
      </div>
      <div class="conn-row__meta">
        <span class="${statusPillClass(check.status)}"><span class="status-pill__dot" aria-hidden="true"></span>${statusLabel(check.status)}</span>
        ${latency}
      </div>
    </div>
  `;
}

function renderChecks(checks: ConnectionCheck[]): void {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const updated = lastRunAt
    ? `Última comprobación: ${new Date(lastRunAt).toLocaleTimeString()}`
    : "Comprobando por primera vez…";

  panel.innerHTML = `
    <div class="conn-list">
      ${checks.map(renderCheckRow).join("")}
    </div>
    <div class="conn-updated">${updated} · Se vuelve a comprobar al abrir esta sección.</div>
  `;
}

function updateSidebarStatus(overall: OverallStatus): void {
  const nameEl = document.getElementById("user-name");
  const emailEl = document.getElementById("user-email");

  if (nameEl) {
    nameEl.textContent =
      overall === "ok"
        ? "Conectado"
        : overall === "warn"
          ? "Conexión parcial"
          : "Sin conexión";
  }

  if (emailEl) {
    const { webUrl } = getConfig();
    emailEl.textContent = webUrl
      ? webUrl.replace(/^https?:\/\//, "")
      : "VITE_WEB_API_URL sin definir";
  }
}

export async function runConexiones(): Promise<void> {
  if (running) return;

  running = true;

  try {
    const checks = await conLoader(
      runConnectionChecks(renderChecks),
      "Comprobando conexiones…",
    );
    lastRunAt = Date.now();
    lastChecks = checks;
    renderChecks(checks);
    updateSidebarStatus(summarizeChecks(checks));
  } finally {
    running = false;
  }
}

/** Mantiene vivo el estado de la red local en la lista de comprobaciones. */
function applyRedStatus(): void {
  if (!lastChecks) return;

  const index = lastChecks.findIndex((check) => check.id === "red");
  if (index < 0) return;

  const red = getNetworkState();
  lastChecks[index] = {
    ...lastChecks[index],
    status: red === "online" ? "ok" : red === "degraded" ? "warn" : "error",
    detail:
      red === "online"
        ? "Conectado a la red"
        : red === "degraded"
          ? "Red disponible, servicio web con problemas"
          : "Sin conexión de red",
  };
  renderChecks([...lastChecks]);
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function syncNowAction(): void {
  void conLoader(syncNow(), "Sincronizando cambios pendientes…").then(
    ({ sent, failed }) => {
      showToast({
        title: sent + failed === 0 ? "Todo sincronizado" : "Sincronización completada",
        message:
          sent + failed === 0
            ? "No hay cambios pendientes."
            : `${sent} cambio(s) enviado(s).${failed > 0 ? ` ${failed} pendiente(s) de reintento.` : ""}`,
        tone: sent + failed === 0 ? "success" : failed > 0 ? "warning" : "success",
      });
    },
  );
}

async function toggleAutostart(): Promise<void> {
  if (!isTauriRuntime()) {
    showToast({
      title: "No disponible en navegador",
      message: "Esta opción solo está disponible en la aplicación de escritorio.",
      tone: "warning",
    });
    return;
  }

  try {
    const current = await invoke<boolean>("get_autostart");
    await invoke<void>("set_autostart", { enabled: !current });
    showToast({
      title: current ? "Autostart desactivado" : "Autostart activado",
      message: current
        ? "La app ya no se iniciará con Windows."
        : "La app se iniciará automáticamente al iniciar sesión en Windows.",
      tone: "success",
    });
  } catch (error) {
    showToast({
      title: "No se pudo cambiar el autostart",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  }
}

export function initConexionesView(): void {
  renderChecks(initialChecks());

  document
    .querySelector('[data-action="recheck"]')
    ?.addEventListener("click", () => void runConexiones());

  document
    .querySelector('[data-action="check-updates"]')
    ?.addEventListener("click", () => void checkAppUpdates(true));

  // Acciones del sistema de seguridad (inyectadas en el toolbar de Conexiones)
  const toolbar = document.querySelector<HTMLElement>("#view-conexiones .view__actions");
  if (toolbar && !toolbar.querySelector('[data-action="sync-now"]')) {
    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.className = "btn btn--secondary";
    syncBtn.dataset.action = "sync-now";
    syncBtn.innerHTML = `${renderIcon("refresh", { size: 16 })} Sincronizar ahora`;
    toolbar.appendChild(syncBtn);

    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "btn btn--secondary";
    autoBtn.dataset.action = "toggle-autostart";
    autoBtn.innerHTML = `${renderIcon("play", { size: 16 })} Iniciar con Windows`;
    toolbar.appendChild(autoBtn);

    mountIcons(toolbar);

    syncBtn.addEventListener("click", syncNowAction);
    autoBtn.addEventListener("click", () => void toggleAutostart());
  }

  onNetworkChange(() => applyRedStatus());
}
