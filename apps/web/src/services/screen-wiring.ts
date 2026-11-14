import type { SessionRecord } from "@neurovision/domain";
import type { ProcessingSnapshot } from "./api-client";
import type { UploadJob, UploadQueueState } from "./upload-queue";

/** API-backed chrome is shown only when the service layer has an API base URL. */
export function showApiControls(apiEnabled: boolean): boolean {
  return apiEnabled;
}

/** Live assessments enqueue an upload after the board flow ends. */
export function shouldEnqueueUpload(input: {
  ended: boolean;
  session: SessionRecord | null;
  apiEnabled: boolean;
}): boolean {
  return Boolean(input.ended && input.apiEnabled && input.session && input.session.source === "live");
}

export function jobForSession(queue: UploadQueueState, sessionId: string): UploadJob | undefined {
  return queue.jobs.find((job) => job.sessionId === sessionId);
}

export function processingLabel(
  snapshot: ProcessingSnapshot | undefined,
  job: UploadJob | undefined,
): string | null {
  if (snapshot) {
    if (snapshot.processing === "ready") return "Ready";
    if (snapshot.processing === "failed") return "Failed";
    if (snapshot.processing === "running") return "Running";
    return "Pending";
  }
  if (!job) return null;
  if (job.status === "acknowledged") return "Uploaded";
  if (job.status === "uploading") return "Uploading";
  if (job.status === "blocked") return "Blocked";
  return "Queued";
}

export function participantIdForExport(input: {
  signedInParticipantId: string | null;
  activeProfileId: string | null;
}): string | null {
  return input.signedInParticipantId ?? input.activeProfileId;
}
