import { pingWeb } from "./web-api";

/**
 * Máquina de estados de conectividad.
 *
 * Estados:
 *  - "online":   hay red y el servicio web responde.
 *  - "degraded": hay red (navegador) pero el servicio web falla (p. ej. 503).
 *  - "offline":  sin red o sin respuesta del servicio.
 *
 * Se alimenta de los eventos online/offline del navegador + sondas reales con
 * backoff exponencial. Cuando se recupera la conexión se notifica a los
 * suscriptores para reenviar la cola offline al instante.
 */

export type NetworkState = "online" | "degraded" | "offline";

const PROBE_MIN_MS = 15_000;
const PROBE_MAX_MS = 120_000;

let state: NetworkState = navigator.onLine ? "online" : "offline";
let probeTimer: number | null = null;
let probing = false;
let started = false;

const listeners = new Set<(s: NetworkState) => void>();

export function getNetworkState(): NetworkState {
  return state;
}

export function onNetworkChange(listener: (s: NetworkState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function setState(next: NetworkState): void {
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener(state));
}

function scheduleProbe(delayMs: number): void {
  if (probeTimer !== null) {
    window.clearTimeout(probeTimer);
  }
  probeTimer = window.setTimeout(() => {
    probeTimer = null;
    void probeNow();
  }, delayMs);
}

/** Sonda real contra la API web. */
export async function probeNow(): Promise<NetworkState> {
  if (probing) return state;
  probing = true;
  try {
    const result = await pingWeb();
    if (result.ok) {
      setState("online");
      scheduleProbe(PROBE_MIN_MS);
    } else {
      setState(navigator.onLine ? "degraded" : "offline");
      scheduleProbe(PROBE_MAX_MS);
    }
  } catch {
    setState(navigator.onLine ? "degraded" : "offline");
    scheduleProbe(PROBE_MAX_MS);
  } finally {
    probing = false;
  }
  return state;
}

/** El heartbeat/polling informan éxito: se considera online. */
export function reportSuccess(): void {
  setState("online");
  scheduleProbe(PROBE_MIN_MS);
}

/** Fallo de una llamada a la red: degradado u offline según el navegador. */
export function reportFailure(): void {
  setState(navigator.onLine ? "degraded" : "offline");
  scheduleProbe(PROBE_MAX_MS);
}

/** Inicializa el monitor (eventos de red + sonda inicial). */
export function initNetwork(): void {
  if (started) return;
  started = true;

  window.addEventListener("online", () => {
    setState("online");
    void probeNow();
  });
  window.addEventListener("offline", () => {
    setState("offline");
  });

  void probeNow();
}
