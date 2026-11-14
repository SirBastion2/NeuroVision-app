import type { LayoutVariant, PracticeRoundSetup, PracticeSuggestion, SessionRecord, TrialRecord } from "@neurovision/domain";
import { addPracticeRound, recordAssessmentTrial } from "./session";

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
  | "gaze";

export interface FlowState {
  screen: Screen;
  session: SessionRecord | null;
  variant: LayoutVariant;
  lineIndex: number;
  /** True once the assessment part has ended; the session is then saved on every change. */
  ended: boolean;
  /** Setup of the round being run or just finished. */
  practice: PracticeRoundSetup | null;
  /** Starting point for the next setup screen (the faded config after a round). */
  nextSuggestion: PracticeSuggestion | null;
}

export type FlowAction =
  | { type: "home" }
  | { type: "go"; screen: Screen }
  | { type: "start"; session: SessionRecord; variant: LayoutVariant }
  | { type: "trial-finished"; trial: TrialRecord }
  | { type: "practice-configured"; setup: PracticeRoundSetup }
  | { type: "practice-finished"; trial: TrialRecord }
  | { type: "next-practice"; config: PracticeSuggestion }
  | { type: "open"; session: SessionRecord };

export const initialFlow: FlowState = {
  screen: "home",
  session: null,
  variant: "fixed-a",
  lineIndex: 0,
  ended: false,
  practice: null,
  nextSuggestion: null,
};

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "home":
      return initialFlow;
    case "go":
      return { ...state, screen: action.screen };
    case "start":
      return { ...initialFlow, screen: "target-intro", session: action.session, variant: action.variant };
    case "open":
      return { ...initialFlow, screen: "review", session: action.session, ended: true };
    case "trial-finished": {
      if (!state.session) return state;
      const { session, finished } = recordAssessmentTrial(state.session, action.trial);
      if (finished) return { ...state, session, ended: true, screen: "review" };
      if (action.trial.task === "target-selection") return { ...state, session, screen: "line-intro", lineIndex: 0 };
      return { ...state, session, screen: "line-task", lineIndex: state.lineIndex + 1 };
    }
    case "practice-configured":
      return { ...state, practice: action.setup, screen: "practice-task" };
    case "practice-finished": {
      if (!state.session || !state.practice) return state;
      return {
        ...state,
        session: addPracticeRound(state.session, action.trial, state.practice.config),
        screen: "practice-reflection",
      };
    }
    case "next-practice":
      return { ...state, nextSuggestion: action.config, screen: "practice-setup" };
  }
}
