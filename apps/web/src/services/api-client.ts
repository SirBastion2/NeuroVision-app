import { isApiEnabled, type WebRuntimeConfig } from "./runtime-config";

export type ProcessingState = "pending" | "running" | "ready" | "failed";
export type CompletionState = "active" | "complete" | "interrupted";
export type SyncState = "local" | "queued" | "uploading" | "acknowledged" | "blocked";

export const TERMINAL_PROCESSING_STATES: ReadonlySet<ProcessingState> = new Set(["ready", "failed"]);

export function isTerminalProcessingState(state: string): state is ProcessingState {
  return TERMINAL_PROCESSING_STATES.has(state as ProcessingState);
}

export interface ProcessingDetail {
  state: ProcessingState;
  retryable: boolean;
  lastError: string | null;
  jobStatus: string | null;
}

export interface ProcessingSnapshot {
  sessionId: string;
  processing: ProcessingState;
  detail: ProcessingDetail | null;
  sealed: boolean;
  terminal: boolean;
}

export interface PutSessionInput {
  sessionId: string;
  participantId: string;
  assignmentId: string;
  assignmentRevision: number;
  startedAt: string;
  completion: CompletionState;
}

export interface SessionResource {
  id: string;
  participantId: string;
  assignmentId: string;
  assignmentRevision: number;
  startedAt: string;
  completion: CompletionState;
  sync: SyncState;
  processing: ProcessingState;
  sealed: boolean;
  sessionRevision: number;
  inputHash: string | null;
  idempotent?: boolean;
  processingDetail?: ProcessingDetail | null;
  record?: unknown;
}

export interface TraceUploadRequest {
  declaredByteCount: number;
  declaredExpandedBytes: number;
  declaredChecksum: string;
  contentType: string;
}

export interface TraceUploadAuthorization {
  traceId: string;
  objectKey: string;
  expiresAt: string;
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
    adapter: string;
    localOnly?: boolean;
  };
}

export interface TraceUploadResult {
  traceId: string;
  status: "uploaded";
}

export interface ExportResult {
  exportId: string;
  bundle: unknown;
}

export interface DeleteResult {
  participantId: string;
  deleted: boolean;
  idempotent: boolean;
}

export interface HealthResult {
  status: "ok";
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ApiOfflineError extends Error {
  constructor(message = "API calls are disabled in the standalone build.") {
    super(message);
    this.name = "ApiOfflineError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  standalone?: boolean;
  fetch?: typeof fetch;
  getAccessToken?: () => string | null;
}

export interface ApiClient {
  readonly enabled: boolean;
  readonly baseUrl: string;
  health(): Promise<HealthResult>;
  putSession(input: PutSessionInput): Promise<SessionResource>;
  createTraceUpload(sessionId: string, request: TraceUploadRequest): Promise<TraceUploadAuthorization>;
  putTraceContent(sessionId: string, traceId: string, bytes: Uint8Array, contentUrl?: string): Promise<TraceUploadResult>;
  uploadTrace(sessionId: string, request: TraceUploadRequest, bytes: Uint8Array): Promise<TraceUploadResult>;
  getSession(sessionId: string): Promise<SessionResource>;
  getProcessingState(sessionId: string): Promise<ProcessingSnapshot>;
  exportParticipant(participantId: string): Promise<ExportResult>;
  deleteParticipant(participantId: string, input?: { confirm?: true }): Promise<DeleteResult>;
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function snapshotFromSession(session: SessionResource): ProcessingSnapshot {
  const processing = session.processingDetail?.state ?? session.processing;
  return {
    sessionId: session.id,
    processing,
    detail: session.processingDetail ?? null,
    sealed: session.sealed,
    terminal: isTerminalProcessingState(processing),
  };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorFrom(status: number, body: unknown, fallback: string): ApiError {
  if (body && typeof body === "object") {
    const record = body as { error?: unknown; message?: unknown; details?: unknown };
    const code = typeof record.error === "string" ? record.error : "http_error";
    const message = typeof record.message === "string" ? record.message : fallback;
    return new ApiError(status, code, message, record.details ?? {});
  }
  return new ApiError(status, "http_error", fallback, {});
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const enabled = isApiEnabled({
    apiBaseUrl: options.baseUrl,
    standalone: options.standalone ?? false,
  });
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);

  const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    if (!enabled) throw new ApiOfflineError();
    const headers = new Headers(init.headers);
    const token = options.getAccessToken?.() ?? null;
    if (token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    const response = await fetchImpl(joinUrl(baseUrl, path), { ...init, headers });
    const body = await readBody(response);
    if (!response.ok) {
      throw errorFrom(response.status, body, `Request failed (${response.status})`);
    }
    return body;
  };

  const json = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return (await request(path, { ...init, headers })) as T;
  };

  const client: ApiClient = {
    enabled,
    baseUrl,

    async health() {
      return json<HealthResult>("/health");
    },

    async putSession(input) {
      const { sessionId, ...body } = input;
      return json<SessionResource>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },

    async createTraceUpload(sessionId, body) {
      return json<TraceUploadAuthorization>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/trace-uploads`,
        { method: "POST", body: JSON.stringify(body) },
      );
    },

    async putTraceContent(sessionId, traceId, bytes, contentUrl) {
      const path =
        contentUrl ??
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/trace-uploads/${encodeURIComponent(traceId)}/content`;
      const payload = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(payload).set(bytes);
      const body = await request(path, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: payload,
      });
      if (body && typeof body === "object" && "traceId" in body) {
        return body as TraceUploadResult;
      }
      return { traceId, status: "uploaded" };
    },

    async uploadTrace(sessionId, requestBody, bytes) {
      const authorization = await client.createTraceUpload(sessionId, requestBody);
      return client.putTraceContent(sessionId, authorization.traceId, bytes, authorization.upload.url);
    },

    async getSession(sessionId) {
      return json<SessionResource>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
    },

    async getProcessingState(sessionId) {
      const session = await client.getSession(sessionId);
      return snapshotFromSession(session);
    },

    async exportParticipant(participantId) {
      return json<ExportResult>(
        `/api/v1/participants/${encodeURIComponent(participantId)}/exports`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },

    async deleteParticipant(participantId, input = { confirm: true }) {
      return json<DeleteResult>(`/api/v1/participants/${encodeURIComponent(participantId)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: input.confirm ?? true }),
      });
    },
  };

  return client;
}

export function createApiClientFromConfig(
  config: Pick<WebRuntimeConfig, "apiBaseUrl" | "standalone">,
  options: Omit<ApiClientOptions, "baseUrl" | "standalone"> = {},
): ApiClient {
  return createApiClient({
    ...options,
    baseUrl: config.apiBaseUrl,
    standalone: config.standalone,
  });
}
