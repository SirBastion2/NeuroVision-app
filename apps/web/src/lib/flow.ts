import type { LayoutVariant, SessionRecord, TrialRecord } from "@neurovision/domain";
import { recordAssessmentTrial } from "./session";

export type Screen =
  | "home"
  | "target-intro"
  | "target-task"
  | "line-intro"
  | "line-task"
  | "review"
  | "practice-setup"
  | "practice-task"
  | "practice-reflection"
  | "history"
  | "my-profile"
  | "profile"
  | "assessment"
  | "starry"
  | "scene"
  | "rings"
  | "lines"
  | "demo";

export interface FlowState {
  screen: Screen;
  session: SessionRecord | null;
  variant: LayoutVariant;
  lineIndex: number;
  /** True once the assessment part has ended; the session is then saved on every change. */
  ended: boolean;
  /** True when line bisection was started on its own, without hollow rings first. */
  linesOnly: boolean;
}

export type FlowAction =
  | { type: "home" }
  | { type: "go"; screen: Screen }
  | { type: "start"; session: SessionRecord; variant: LayoutVariant }
  | { type: "start-lines"; session: SessionRecord }
  | { type: "trial-finished"; trial: TrialRecord }
  | { type: "open"; session: SessionRecord };

export const initialFlow: FlowState = {
  screen: "home",
  session: null,
  variant: "fixed-a",
  lineIndex: 0,
  ended: false,
  linesOnly: false,
};

/** Retired screens keep their names so old `go` calls still resolve. */
export function resolveScreen(screen: Screen, hasSession = false): Screen {
  if (screen === "my-profile" || screen === "profile") return "history";
  if (screen === "practice-setup" || screen === "practice-task" || screen === "practice-reflection") {
    return hasSession ? "review" : "home";
  }
  return screen;
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "home":
      return initialFlow;
    case "go":
      return { ...state, screen: resolveScreen(action.screen, Boolean(state.session)) };
    case "start":
      return { ...initialFlow, screen: "target-intro", session: action.session, variant: action.variant };
    case "start-lines":
      return { ...initialFlow, screen: "line-intro", session: action.session, linesOnly: true };
    case "open":
      return { ...initialFlow, screen: "review", session: action.session, ended: true };
    case "trial-finished": {
      if (!state.session) return state;
      const { session, finished } = recordAssessmentTrial(state.session, action.trial);
      if (finished) return { ...state, session, ended: true, screen: "review" };
      if (action.trial.task === "target-selection") return { ...state, session, screen: "line-intro", lineIndex: 0 };
      return { ...state, session, screen: "line-task", lineIndex: state.lineIndex + 1 };
    }
  }
}
