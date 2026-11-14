import type { SessionRecord } from "@neurovision/domain";
import {
  ApiError,
  ApiOfflineError,
  type ApiClient,
  type CompletionState,
  type TraceUploadRequest,
} from "./api-client";
import { base64ToBytes, bytesToBase64, contentHash } from "./hash";
import type { KeyValueStore } from "./package-store";

export const UPLOAD_QUEUE_KEY = "spatial-patterns:upload-queue:v1";

export type UploadJobStatus = "queued" | "uploading" | "acknowledged" | "blocked";
export type UploadJobStep = "session" | "batch" | "trace" | "finalize" | "done";

export interface QueuedTrace {
  request: TraceUploadRequest;
  bytesBase64: string;
}

export interface UploadJob {
  id: string;
  sessionId: string;
  batchId: string;
  participantId: string;
  assignmentId: string;
  assignmentRevision: number;
  startedAt: string;
  completion: CompletionState;
  session: SessionRecord;
  traces: QueuedTrace[];
  attempts: number;
  nextAttemptAt: number;
  status: UploadJobStatus;
  step: UploadJobStep;
  lastError: string | null;
}

export interface UploadQueueState {
  jobs: UploadJob[];
  pending: number;
  uploading: number;
  acknowledged: number;
  blocked: number;
  online: boolean;
}

export interface EnqueueUploadInput {
  session: SessionRecord;
  participantId?: string;
  assignmentId?: string;
  assignmentRevision?: number;
  traces?: ReadonlyArray<{ request: TraceUploadRequest; bytes: Uint8Array }>;
  batchId?: string;
}

export interface UploadQueue {
  enqueue(input: EnqueueUploadInput): Promise<UploadJob>;
  getState(): UploadQueueState;
  subscribe(listener: (state: UploadQueueState) => void): () => void;
  drain(): Promise<UploadQueueState>;
  peek(sessionId: string): UploadJob | undefined;
  cancel(sessionId: string): void;
}

export interface CreateUploadQueueOptions {
  api: ApiClient;
  store: KeyValueStore;
  isOnline?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  listenOnline?: (handler: () => void) => () => void;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const QUEUE_VERSION = 1;

interface QueueEnvelope {
  version: number;
  jobs: UploadJob[];
}

function emptyState(jobs: UploadJob[], online: boolean): UploadQueueState {
  return {
    jobs: jobs.map((job) => ({ ...job, traces: job.traces.map((trace) => ({ ...trace })) })),
    pending: jobs.filter((job) => job.status === "queued").length,
    uploading: jobs.filter((job) => job.status === "uploading").length,
    acknowledged: jobs.filter((job) => job.status === "acknowledged").length,
    blocked: jobs.filter((job) => job.status === "blocked").length,
    online,
  };
}

function readQueue(store: KeyValueStore): UploadJob[] {
  const raw = store.getItem(UPLOAD_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<QueueEnvelope>;
    if (parsed.version !== QUEUE_VERSION || !Array.isArray(parsed.jobs)) return [];
    return parsed.jobs.map((job) => (job.status === "uploading" ? { ...job, status: "queued" as const } : job));
  } catch {
    return [];
  }
}

function writeQueue(store: KeyValueStore, jobs: UploadJob[]): void {
  store.setItem(UPLOAD_QUEUE_KEY, JSON.stringify({ version: QUEUE_VERSION, jobs } satisfies QueueEnvelope));
}

function completionOf(session: SessionRecord): CompletionState {
  if (session.status === "complete") return "complete";
  return "interrupted";
}

function defaultOnline(): boolean {
  try {
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    if (!nav || nav.onLine === undefined) return true;
    return nav.onLine;
  } catch {
    return true;
  }
}

function defaultListenOnline(handler: () => void): () => void {
  try {
    const target = globalThis as { addEventListener?: typeof addEventListener; removeEventListener?: typeof removeEventListener };
    if (!target.addEventListener || !target.removeEventListener) return () => undefined;
    target.addEventListener("online", handler);
    return () => target.removeEventListener?.("online", handler);
  } catch {
    return () => undefined;
  }
}

function backoffMs(attempts: number, initialDelayMs: number, maxDelayMs: number): number {
  const delay = initialDelayMs * 2 ** Math.max(0, attempts - 1);
  return Math.min(maxDelayMs, Math.max(initialDelayMs, delay));
}

function shellOf(session: SessionRecord): Omit<SessionRecord, "trials" | "practice"> {
  const { trials: _trials, practice: _practice, ...shell } = session;
  return shell;
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

class UploadJobCancelled extends Error {
  constructor() {
    super("Upload job was cancelled.");
    this.name = "UploadJobCancelled";
  }
}

/**
 * Persist pending session and trace uploads, retry with backoff while online,
 * and stay idempotent by session id and batch id across reloads.
 */
export function createUploadQueue(options: CreateUploadQueueOptions): UploadQueue {
  const now = options.now ?? (() => Date.now());
  const isOnline = options.isOnline ?? defaultOnline;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const initialDelayMs = options.initialDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  let jobs = readQueue(options.store);
  writeQueue(options.store, jobs);
  const listeners = new Set<(state: UploadQueueState) => void>();
  let draining: Promise<UploadQueueState> | null = null;

  const emit = (): UploadQueueState => {
    const state = emptyState(jobs, isOnline());
    for (const listener of listeners) listener(state);
    return state;
  };

  const persist = (): void => {
    writeQueue(options.store, jobs);
    emit();
  };

  const update = (id: string, patch: Partial<UploadJob>): UploadJob => {
    jobs = jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
    persist();
    const current = jobs.find((job) => job.id === id);
    if (!current) throw new UploadJobCancelled();
    return current;
  };

  const fail = (job: UploadJob, error: unknown): UploadJob => {
    const attempts = job.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    const wait = backoffMs(attempts, initialDelayMs, maxDelayMs);
    const updated = update(job.id, {
      status: "blocked",
      attempts,
      lastError: message,
      nextAttemptAt: now() + wait,
    });
    void sleep(wait).then(() => {
      if (!isOnline()) return;
      const current = jobs.find((item) => item.id === updated.id);
      if (!current || current.status === "acknowledged") return;
      update(current.id, { status: "queued", nextAttemptAt: now() });
      void drain();
    });
    return updated;
  };

  const processJob = async (job: UploadJob): Promise<void> => {
    if (!options.api.enabled) throw new ApiOfflineError();
    let current = update(job.id, { status: "uploading", lastError: null });
    const sessionId = current.sessionId;
    try {
      if (current.step === "session") {
        try {
          const assignment = await options.api.createAssignment({
            id: current.assignmentId,
            participantId: current.participantId,
            exposureStatus: "seen",
            manifest: {
              protocol: current.session.protocol,
              scorer: current.session.scorer,
              taskIds: current.session.taskIds,
              source: current.session.source,
              input: current.session.input,
              accessibilityId: "default",
              configHash: current.session.id,
            },
          });
          current = update(current.id, {
            assignmentId: assignment.id,
            assignmentRevision: assignment.revision,
          });
        } catch {
          /* Demo seed or a caller-supplied assignment is used when this is not allowed. */
        }
        try {
          await options.api.putSession({
            sessionId,
            participantId: current.participantId,
            assignmentId: current.assignmentId,
            assignmentRevision: current.assignmentRevision,
            startedAt: current.startedAt,
            completion: current.completion,
          });
        } catch (error) {
          if (!isConflict(error)) throw error;
        }
        current = update(current.id, { step: "batch" });
      }
      if (current.step === "batch") {
        const payload = {
          sequence: 1,
          parentBatchId: null,
          shell: shellOf(current.session),
          trials: current.session.trials,
          practice: current.session.practice,
        };
        const hash = await contentHash(payload);
        try {
          await options.api.putBatch(sessionId, current.batchId, { ...payload, contentHash: hash });
        } catch (error) {
          if (!isConflict(error)) throw error;
        }
        current = update(current.id, { step: current.traces.length > 0 ? "trace" : "finalize" });
      }
      if (current.step === "trace") {
        for (const trace of current.traces) {
          try {
            await options.api.uploadTrace(sessionId, trace.request, base64ToBytes(trace.bytesBase64));
          } catch (error) {
            if (!isConflict(error)) throw error;
          }
        }
        current = update(current.id, { step: "finalize" });
      }
      if (current.step === "finalize") {
        try {
          await options.api.finalizeSession(sessionId);
        } catch (error) {
          if (!isConflict(error)) throw error;
        }
        update(current.id, { step: "done", status: "acknowledged", lastError: null });
      }
    } catch (error) {
      if (error instanceof UploadJobCancelled) return;
      fail(current, error);
    }
  };

  const drain = (): Promise<UploadQueueState> => {
    if (draining) return draining;
    draining = (async () => {
      if (!isOnline() || !options.api.enabled) return emit();
      const due = jobs.filter(
        (job) => job.step !== "done" && job.status !== "acknowledged" && job.nextAttemptAt <= now(),
      );
      for (const job of due) {
        if (!isOnline()) break;
        const latest = jobs.find((item) => item.id === job.id);
        if (!latest || latest.status === "acknowledged") continue;
        await processJob(latest);
      }
      return emit();
    })().finally(() => {
      draining = null;
    });
    return draining;
  };

  const stopListening = (options.listenOnline ?? defaultListenOnline)(() => {
    void drain();
  });
  void stopListening;

  return {
    async enqueue(input) {
      if (!options.api.enabled) throw new ApiOfflineError();
      const session = input.session;
      const id = session.id;
      const existing = jobs.find((job) => job.id === id);
      if (existing?.status === "acknowledged") return existing;
      const job: UploadJob = {
        id,
        sessionId: session.id,
        batchId: input.batchId ?? existing?.batchId ?? `${session.id}-batch-1`,
        participantId: input.participantId ?? existing?.participantId ?? session.profileId,
        assignmentId: input.assignmentId ?? existing?.assignmentId ?? `assign-${session.profileId}`,
        assignmentRevision: input.assignmentRevision ?? existing?.assignmentRevision ?? 1,
        startedAt: session.startedAt,
        completion: completionOf(session),
        session,
        traces: (input.traces ?? []).map((trace) => ({
          request: trace.request,
          bytesBase64: bytesToBase64(trace.bytes),
        })),
        attempts: existing?.attempts ?? 0,
        nextAttemptAt: 0,
        status: "queued",
        step: existing && existing.step !== "done" ? existing.step : "session",
        lastError: null,
      };
      jobs = [...jobs.filter((item) => item.id !== id), job];
      persist();
      void drain();
      return job;
    },

    getState() {
      return emptyState(jobs, isOnline());
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(emptyState(jobs, isOnline()));
      return () => {
        listeners.delete(listener);
      };
    },

    drain,

    peek(sessionId) {
      return jobs.find((job) => job.sessionId === sessionId);
    },

    cancel(sessionId) {
      const next = jobs.filter((job) => job.sessionId !== sessionId);
      if (next.length === jobs.length) return;
      jobs = next;
      persist();
    },
  };
}
