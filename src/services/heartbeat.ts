import { APP_VERSION, getInstanceId } from "../lib/config";
import {
  sendHeartbeat,
  type ApiResult,
  type HeartbeatResponse,
} from "../lib/web-api";

const HEARTBEAT_INTERVAL_MS = 30_000;

type HeartbeatListener = (result: ApiResult<HeartbeatResponse>) => void;

let timer: number | null = null;
let lastResult: ApiResult<HeartbeatResponse> | null = null;
const listeners = new Set<HeartbeatListener>();

async function tick(): Promise<void> {
  const result = await sendHeartbeat({
    version: APP_VERSION,
    instanceId: getInstanceId(),
  });

  lastResult = result;
  listeners.forEach((listener) => listener(result));
}

export function onHeartbeatResult(
  listener: HeartbeatListener,
): () => void {
  listeners.add(listener);

  if (lastResult) {
    listener(lastResult);
  }

  return () => {
    listeners.delete(listener);
  };
}

/** Envía un heartbeat inmediato y luego cada 30 s a la web. */
export function startHeartbeat(): void {
  stopHeartbeat();
  void tick();
  timer = window.setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}
