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
