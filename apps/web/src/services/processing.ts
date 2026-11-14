import {
  createApiClientFromConfig,
  type ApiClient,
  type DeleteResult,
  type ExportResult,
  type ProcessingSnapshot,
} from "./api-client";
import { readRuntimeConfig, type WebRuntimeConfig } from "./runtime-config";

export interface PollProcessingOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  onUpdate?: (snapshot: ProcessingSnapshot) => void;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

/**
 * Dashboard polling for session processing state. Fetches immediately, then
 * waits with exponential backoff until a terminal state (`ready` or `failed`).
 */
export async function pollProcessingState(
  client: ApiClient,
  sessionId: string,
  options: PollProcessingOptions = {},
): Promise<ProcessingSnapshot> {
  const initialDelayMs = options.initialDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const multiplier = options.multiplier ?? 2;
  const sleep = options.sleep ?? ((ms: number) => defaultSleep(ms, options.signal));

  let delay = initialDelayMs;
  let snapshot = await client.getProcessingState(sessionId);
  options.onUpdate?.(snapshot);
  while (!snapshot.terminal) {
    throwIfAborted(options.signal);
    await sleep(delay);
    throwIfAborted(options.signal);
    snapshot = await client.getProcessingState(sessionId);
    options.onUpdate?.(snapshot);
    delay = Math.min(maxDelayMs, Math.max(1, Math.round(delay * multiplier)));
  }
  return snapshot;
}

export async function exportParticipant(
  client: ApiClient,
  participantId: string,
): Promise<ExportResult> {
  return client.exportParticipant(participantId);
}

export async function deleteParticipant(
  client: ApiClient,
  participantId: string,
  input?: { confirm?: true },
): Promise<DeleteResult> {
  return client.deleteParticipant(participantId, input);
}

export function dashboardApi(
  clientOrConfig: ApiClient | Pick<WebRuntimeConfig, "apiBaseUrl" | "standalone"> = readRuntimeConfig(),
) {
  const client =
    "getProcessingState" in clientOrConfig
      ? clientOrConfig
      : createApiClientFromConfig(clientOrConfig);
  return {
    client,
    pollProcessingState: (sessionId: string, options?: PollProcessingOptions) =>
      pollProcessingState(client, sessionId, options),
    exportParticipant: (participantId: string) => exportParticipant(client, participantId),
    deleteParticipant: (participantId: string, input?: { confirm?: true }) =>
      deleteParticipant(client, participantId, input),
  };
}
