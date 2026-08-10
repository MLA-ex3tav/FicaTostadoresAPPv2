import { kvList, kvRemove, kvSet } from "./kv";
import { getNetworkState } from "./network";

/**
 * Cola de operaciones offline durable.
 *
 * Cada mutación (cambiar estado, crear/editar/eliminar solicitud o producto…)
 * que no se puede enviar por falta de conexión se guarda en el store durable
 * (SQLite vía Rust / localStorage en dev). Al reconectar se reenvía en orden.
 */

export interface QueuedOp {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

type Executor = (payload: unknown) => Promise<boolean>;

const QUEUE_PREFIX = "queue:";

const executors = new Map<string, Executor>();
const listeners = new Set<(count: number) => void>();

function opKey(id: string): string {
  return QUEUE_PREFIX + id;
}

export async function pendingCount(): Promise<number> {
  try {
    return (await kvList(QUEUE_PREFIX)).length;
  } catch {
    return 0;
  }
}

export async function enqueueOp(type: string, payload: unknown): Promise<string> {
  const id = crypto.randomUUID();
  const op: QueuedOp = { id, type, payload, createdAt: Date.now() };
  await kvSet(opKey(id), JSON.stringify(op));
  void emitCount();
  return id;
}

export function registerExecutor(type: string, fn: Executor): void {
  executors.set(type, fn);
}

function emitCount(): void {
  void pendingCount().then((count) => {
    listeners.forEach((listener) => listener(count));
  });
}

export function onQueueCount(listener: (count: number) => void): () => void {
  listeners.add(listener);
  void pendingCount().then(listener);
  return () => {
    listeners.delete(listener);
  };
}

let flushing = false;

/**
 * Reenvía la cola pendiente en orden. Se detiene ante el primer fallo para
 * preservar el orden de las operaciones. No hace nada si la red está offline.
 */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  if (flushing || getNetworkState() === "offline") {
    return { sent: 0, failed: 0 };
  }

  flushing = true;
  let sent = 0;
  let failed = 0;

  try {
    const items = await kvList(QUEUE_PREFIX);
    const ops: QueuedOp[] = [];

    for (const [, value] of items) {
      try {
        ops.push(JSON.parse(value) as QueuedOp);
      } catch {
        /* entrada corrupta: se ignora */
      }
    }
    ops.sort((a, b) => a.createdAt - b.createdAt);

    for (const op of ops) {
      const executor = executors.get(op.type);
      if (!executor) {
        failed += 1;
        continue;
      }
      try {
        const ok = await executor(op.payload);
        if (ok) {
          await kvRemove(opKey(op.id));
          sent += 1;
        } else {
          failed += 1;
          break;
        }
      } catch {
        failed += 1;
        break;
      }
    }
  } finally {
    flushing = false;
    void emitCount();
  }

  return { sent, failed };
}
