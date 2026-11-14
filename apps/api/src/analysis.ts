import { CONTRACTS_VERSION, scoreSession, type SessionRecord } from "@neurovision/domain";
import type { ComparisonEligibility, CompletionState } from "./contracts.provisional.js";

/** Gaze analysis is intentionally unfinished. Agent 3 owns the real implementation. */
export const GAZE_STUB_VERSION = "gaze-stub-0";

export const ANALYSIS_VERSION = `${CONTRACTS_VERSION}+${GAZE_STUB_VERSION}`;

export const GAZE_STUB_REASON =
  "Gaze analysis is a stub. Click scoring uses @neurovision/domain. Agent 3 replaces gaze metrics.";

export interface DerivedSummary {
  stub: true;
  stubReason: string;
  analysisVersion: string;
  inputHash: string;
  sessionRevision: number;
  scoring: ReturnType<typeof scoreSession>;
  gazeAnalysis: {
    stub: true;
    version: string;
    metrics: null;
  };
  eligibility: ComparisonEligibility;
  provenance: {
    contractsVersion: string;
    source: SessionRecord["source"];
  };
}

export function buildDerivedSummary(input: {
  record: SessionRecord;
  completion: CompletionState;
  inputHash: string;
  sessionRevision: number;
}): DerivedSummary {
  const scoring = scoreSession(input.record);
  const reasons: string[] = [];
  if (input.record.source !== "live") reasons.push("source_not_live");
  if (input.record.status !== "complete") reasons.push("session_incomplete");
  if (input.completion !== "complete") reasons.push("completion_not_complete");
  reasons.push("gaze_analysis_stub");
  const click =
    input.record.source === "live" && input.record.status === "complete" && input.completion === "complete";
  return {
    stub: true,
    stubReason: GAZE_STUB_REASON,
    analysisVersion: ANALYSIS_VERSION,
    inputHash: input.inputHash,
    sessionRevision: input.sessionRevision,
    scoring,
    gazeAnalysis: {
      stub: true,
      version: GAZE_STUB_VERSION,
      metrics: null,
    },
    eligibility: {
      click,
      gaze: false,
      reasons,
      groupKey: `${input.record.protocol}:${input.record.scorer}:${input.record.source}:${input.record.input}`,
    },
    provenance: {
      contractsVersion: CONTRACTS_VERSION,
      source: input.record.source,
    },
  };
}
