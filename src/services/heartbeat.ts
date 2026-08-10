import { APP_VERSION } from "../lib/config";
import { getStableInstanceId } from "../lib/secure-store";
import {
  getNetworkState,
  onNetworkChange,
  reportFailure,
  reportSuccess,
} from "../lib/network";
import {
  sendHeartbeat,
  type ApiResult,
  type HeartbeatResponse,
} from "../lib/web-api";

const HEARTBEAT_INTERVAL_MS = 30_000;

type HeartbeatListener = (result: ApiResult<HeartbeatResponse>) => void;

let timer: number | null = null;
let unsubscribeNetwork: (() => void) | null = null;
let lastResult: ApiResult<HeartbeatResponse> | null = null;
const listeners = new Set<HeartbeatListener>();

async function tick(): Promise<void> {
  if (getNetworkState() === "offline") {
    const offlineResult: ApiResult<HeartbeatResponse> = {
      ok: false,
      status: null,
      latencyMs: 0,
      data: null,
      error: "Sin conexión",
    };
    lastResult = offlineResult;
    listeners.forEach((listener) => listener(offlineResult));
    return;
  }

  const result = await sendHeartbeat({
    version: APP_VERSION,
    instanceId: await getStableInstanceId(),
  });

  if (result.ok) {
    reportSuccess();
  } else {
    reportFailure();
  }

  lastResult = result;
  listeners.forEach((listener) => listener(result));
}

export function onHeartbeatResult(listener: HeartbeatListener): () => void {
  listeners.add(listener);

  if (lastResult) {
    listener(lastResult);
  }

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Envía un heartbeat inmediato y luego cada 30 s. Cuando la red vuelve
 * (transición a online) se envía uno al instante para acelerar la reconexión.
 */
export function startHeartbeat(): void {
  stopHeartbeat();
  void tick();
  timer = window.setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
  unsubscribeNetwork = onNetworkChange((networkState) => {
    if (networkState === "online") {
      void tick();
    }
  });
}

export function stopHeartbeat(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (unsubscribeNetwork) {
    unsubscribeNetwork();
    unsubscribeNetwork = null;
  }
}
