/**
 * "Up next" interstitial timing.
 *
 * The CSS bar is 1.8s with `animation-fill-mode: both`, so it finishes and
 * stays full even if JavaScript never advances. Auto-advance must therefore
 * be armed once per mount: putting `onGo` in a React effect dependency list
 * clears the timeout on every parent re-render (save, upload queue, auth,
 * StrictMode) and the next test never starts.
 *
 * Advancing is local `setState`. It must not await session save or `/api`.
 */

export const NEXT_UP_ADVANCE_MS = 2600;
export const NEXT_UP_CONTINUE_MS = 5000;

export type NextUpTimerId = ReturnType<typeof setTimeout>;

export interface NextUpTimers {
  setTimeout: (handler: () => void, ms: number) => NextUpTimerId;
  clearTimeout: (id: NextUpTimerId) => void;
}

const defaultTimers: NextUpTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Arm auto-advance and a Continue fallback once. Cleanup (unmount / StrictMode)
 * clears both; a remount re-arms. Changing the advance function after this
 * returns does not reset the clock — callers should pass a getter/ref.
 *
 * `onNeedContinue` runs at 5s if the card is still mounted, even if auto-advance
 * already ran and failed to leave the screen.
 */
export function armNextUpAdvance(
  getAdvance: () => void,
  onNeedContinue: () => void,
  timers: NextUpTimers = defaultTimers,
): () => void {
  let unmounted = false;
  const advanceId = timers.setTimeout(() => {
    if (unmounted) return;
    try {
      getAdvance();
    } catch {
      /* Continue remains the way off the card */
    }
  }, NEXT_UP_ADVANCE_MS);
  const continueId = timers.setTimeout(() => {
    if (!unmounted) onNeedContinue();
  }, NEXT_UP_CONTINUE_MS);
  return () => {
    unmounted = true;
    timers.clearTimeout(advanceId);
    timers.clearTimeout(continueId);
  };
}

/**
 * The identity-tied timer that left the "Up next" card on screen forever.
 * Exported so the regression test can reproduce the stuck case: each new `onGo`
 * (parent re-render) clears the pending timeout and starts a fresh 2.6s wait.
 */
export function armNextUpAdvanceOnCallbackIdentity(
  onGo: () => void,
  timers: NextUpTimers = defaultTimers,
): () => void {
  const id = timers.setTimeout(onGo, NEXT_UP_ADVANCE_MS);
  return () => timers.clearTimeout(id);
}
