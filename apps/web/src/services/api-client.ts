import { isApiEnabled, type WebRuntimeConfig } from "./runtime-config";

export type ProcessingState = "pending" | "running" | "ready" | "failed";
export type CompletionState = "active" | "complete" | "interrupted";
export type SyncState = "local" | "queued" | "uploading" | "acknowledged" | "blocked";

export const TERMINAL_PROCESSING_STATES: ReadonlySet<ProcessingState> = new Set(["ready", "failed"]);
export const CSRF_COOKIE = "nv_csrf";

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

export interface BatchPayloadInput {
  sequence: number;
  parentBatchId: string | null;
  shell: unknown;
  trials: unknown[];
  practice: unknown[];
  contentHash: string;
}

export interface BatchResult {
  batchId: string;
  sequence: number;
  idempotent: boolean;
}

export interface FinalizeResult {
  sessionId: string;
  sealed: boolean;
  idempotent: boolean;
  jobId: string | null;
  inputHash: string | null;
  processing: ProcessingState;
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

export interface Me {
  subject: string;
  orgId: string;
  role: string;
  csrfToken: string;
}

export interface ParticipantListItem {
  id: string;
  orgId?: string;
  label?: string;
  subject: string | null;
}

export interface AssignmentResult {
  id: string;
  revision: number;
  manifestHash?: string;
  exposureStatus?: string;
  manifest?: unknown;
  idempotent?: boolean;
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
  getCsrfToken?: () => string | null;
  onCsrfToken?: (token: string | null) => void;
}

export interface ApiClient {
  readonly enabled: boolean;
  readonly baseUrl: string;
  getCsrfToken(): string | null;
  health(): Promise<HealthResult>;
  getMe(): Promise<Me>;
  signInLocal(input: { subject: string; orgId: string }): Promise<Me>;
  completeAuthCallback(code: string, state: string): Promise<void>;
  logout(): Promise<{ signedOut: boolean }>;
  listParticipants(): Promise<{ participants: ParticipantListItem[] }>;
  listSessions(): Promise<{ sessions: unknown[]; batteries: unknown[]; activity: Array<{ bucket: string; count: number }> }>;
  getNorms(): Promise<{ n: number; source: "assumed" | "fitted"; notice: string; norms: unknown }>;
  createAssignment(input: {
    id?: string;
    participantId: string;
    exposureStatus: "unseen" | "seen" | "unknown";
    manifest: unknown;
  }): Promise<AssignmentResult>;
  putSession(input: PutSessionInput): Promise<SessionResource>;
  putBattery(sessionId: string, record: unknown): Promise<{ sessionId: string; sealed: boolean; battery: boolean; idempotent?: boolean }>;
  putBatch(sessionId: string, batchId: string, payload: BatchPayloadInput): Promise<BatchResult>;
  finalizeSession(sessionId: string): Promise<FinalizeResult>;
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
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base || base === "/" || base === ".") return trimmedPath;
  return `${base.replace(/\/+$/, "")}${trimmedPath}`;
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

function readCookie(name: string): string | null {
  try {
    const cookie = (globalThis as { document?: { cookie?: string } }).document?.cookie;
    if (!cookie) return null;
    const parts = cookie.split(";");
    for (const part of parts) {
      const [rawKey, ...rest] = part.trim().split("=");
      if (rawKey === name) return decodeURIComponent(rest.join("="));
    }
    return null;
  } catch {
    return null;
  }
}

function asMe(body: unknown, fallbackCsrf: string | null): Me {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const csrf =
    typeof record.csrfToken === "string"
      ? record.csrfToken
      : fallbackCsrf ?? "";
  return {
    subject: typeof record.subject === "string" ? record.subject : "",
    orgId: typeof record.orgId === "string" ? record.orgId : "",
    role: typeof record.role === "string" ? record.role : "",
    csrfToken: csrf,
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const enabled = isApiEnabled({
    apiBaseUrl: options.baseUrl,
    standalone: options.standalone ?? false,
  });
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  let csrf = options.getCsrfToken?.() ?? null;

  const rememberCsrf = (token: string | null): void => {
    csrf = token;
    options.onCsrfToken?.(token);
  };

  const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    if (!enabled) throw new ApiOfflineError();
    const headers = new Headers(init.headers);
    const token = options.getAccessToken?.() ?? null;
    if (token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    const method = (init.method ?? "GET").toUpperCase();
    const csrfToken = options.getCsrfToken?.() ?? csrf ?? readCookie(CSRF_COOKIE);
    if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(method) && !headers.has("x-csrf-token")) {
      headers.set("x-csrf-token", csrfToken);
    }
    const response = await fetchImpl(joinUrl(baseUrl, path), {
      ...init,
      headers,
      credentials: "include",
    });
    const body = await readBody(response);
    if (!response.ok) {
      throw errorFrom(response.status, body, `Request failed (${response.status})`);
    }
    if (body && typeof body === "object" && "csrfToken" in body && typeof (body as Me).csrfToken === "string") {
      rememberCsrf((body as Me).csrfToken);
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

    getCsrfToken() {
      return options.getCsrfToken?.() ?? csrf ?? readCookie(CSRF_COOKIE);
    },

    async health() {
      return json<HealthResult>("/health");
    },

    async getMe() {
      return asMe(await json<unknown>("/api/v1/me"), csrf);
    },

    async signInLocal(input) {
      const me = asMe(
        await json<unknown>("/api/v1/auth/local", {
          method: "POST",
          body: JSON.stringify(input),
        }),
        csrf,
      );
      rememberCsrf(me.csrfToken || csrf);
      return me;
    },

    async completeAuthCallback(code, state) {
      if (!enabled) throw new ApiOfflineError();
      const path = `/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      const response = await fetchImpl(joinUrl(baseUrl, path), {
        method: "GET",
        credentials: "include",
        redirect: "manual",
      });
      if (response.type === "opaqueredirect" || (response.status >= 200 && response.status < 400)) {
        return;
      }
      const body = await readBody(response);
      throw errorFrom(response.status, body, `Request failed (${response.status})`);
    },

    async logout() {
      const result = await json<{ signedOut: boolean }>("/api/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      rememberCsrf(null);
      return result;
    },

    async listParticipants() {
      const body = await json<{ participants?: ParticipantListItem[] }>("/api/v1/participants");
      return { participants: body.participants ?? [] };
    },

    async listSessions() {
      const body = await json<{
        sessions?: unknown[];
        batteries?: unknown[];
        activity?: Array<{ bucket: string; count: number }>;
      }>("/api/v1/sessions");
      return {
        sessions: body.sessions ?? [],
        batteries: body.batteries ?? [],
        activity: body.activity ?? [],
      };
    },

    async getNorms() {
      return json<{ n: number; source: "assumed" | "fitted"; notice: string; norms: unknown }>("/api/v1/norms");
    },

    async createAssignment(input) {
      return json<AssignmentResult>("/api/v1/assignments", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async putSession(input) {
      const { sessionId, ...body } = input;
      return json<SessionResource>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },

    async putBattery(sessionId, record) {
      return json<{ sessionId: string; sealed: boolean; battery: boolean; idempotent?: boolean }>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/battery`,
        { method: "PUT", body: JSON.stringify(record) },
      );
    },

    async putBatch(sessionId, batchId, payload) {
      return json<BatchResult>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/batches/${encodeURIComponent(batchId)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      );
    },

    async finalizeSession(sessionId) {
      return json<FinalizeResult>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/finalize`, {
        method: "POST",
        body: JSON.stringify({}),
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
