import type { StackedPhase } from "./stackedTrials";

/** Trial progress in the same ring as the task timer, counting up instead of down. */
export function TrialDial({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div className="timer trial-dial" role="img" aria-label={`${label} ${Math.min(done + 1, total)} of ${total}`}>
      <svg viewBox="0 0 44 44" aria-hidden>
        <circle className="timer-track" cx="22" cy="22" r="19" />
        <circle className="timer-arc" cx="22" cy="22" r="19" pathLength={100} strokeDasharray={`${(100 * done) / total} 100`} />
      </svg>
      <span>
        {Math.min(done + 1, total)}
        <small>/{total}</small>
      </span>
    </div>
  );
}

/** Which keys mean top and bottom. Shown centred under the stimulus so it never pulls the eye sideways. */
export function KeyHints({ top, bottom }: { top: string; bottom: string }) {
  return (
    <p className="key-hints">
      <span>
        <kbd>↑</kbd>
        <kbd>W</kbd> {top}
      </span>
      <span>
        <kbd>↓</kbd>
        <kbd>S</kbd> {bottom}
      </span>
      <span>or tap it</span>
    </p>
  );
}

/** Covers the stimulus area before the run and while paused, like `.board-wait` in the board tasks. */
export function StartOverlay({ phase, onBegin, ready, paused, auto = false }: { phase: StackedPhase; onBegin: () => void; ready: string; paused: string; auto?: boolean }) {
  if (phase !== "ready" && phase !== "paused") return null;
  const starting = auto && phase === "ready";
  return (
    <div className="board-wait stack-wait">
      <div>
        <p>{phase === "ready" ? ready : paused}</p>
        {starting ? (
          <p className="stack-auto" role="status">
            Starting by itself…
          </p>
        ) : (
          <button className="primary" onClick={onBegin} autoFocus>
            {phase === "ready" ? "Start" : "Resume"}
            <kbd className="on-accent">Space</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
