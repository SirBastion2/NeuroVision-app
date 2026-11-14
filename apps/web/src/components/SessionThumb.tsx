import { findTargetSelectionTrial, scoreTargetSelection, type SessionRecord } from "@neurovision/domain";
import { ResponseOrderPlot } from "./ResponseOrderPlot";

/** Miniature of a session's target-selection result, used on cards. */
export function SessionThumb({ session }: { session: SessionRecord }) {
  const trial = findTargetSelectionTrial(session);
  if (!trial) return <div className="thumb-empty">No target-selection trial</div>;
  const score = scoreTargetSelection(trial);
  return <ResponseOrderPlot layout={trial.layout} orderedHits={score.orderedHits} events={trial.events} compact />;
}
