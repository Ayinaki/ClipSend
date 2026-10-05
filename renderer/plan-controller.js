// Live export-plan scheduler.
//
// Planning is pure, fast arithmetic in main/export-planner.js, so making the
// user press "Calculate Plan" after every trim nudge, preset change, crop
// drag or speed bump was pure friction: each of those handlers used to *hide*
// the estimate and wait for a click. This module owns just the scheduling
// policy around a recompute (debounce, coalescing, suspend during an export),
// with timers injected so the policy is unit-testable without a DOM or real
// time. It deliberately knows nothing about media, IPC, or the DOM: the caller
// passes a `run` that does the actual work.

/** Trailing debounce for a recompute: long enough to coalesce a burst of
 *  slider input events, short enough that the estimate feels immediate. */
export const DEFAULT_DEBOUNCE_MS = 180;

/**
 * Create a debounced plan scheduler.
 *
 * @param {object} options
 * @param {() => (void|Promise<void>)} options.run - the recompute to invoke.
 * @param {number} [options.delayMs] - debounce window.
 * @param {Function} [options.setTimer] - setTimeout-alike (injected for tests).
 * @param {Function} [options.clearTimer] - clearTimeout-alike (injected).
 * @returns {{
 *   schedule: () => boolean,
 *   flush: () => boolean,
 *   cancel: () => void,
 *   suspend: (value: boolean) => void,
 *   isSuspended: () => boolean,
 *   isPending: () => boolean,
 *   runCount: () => number
 * }}
 */
export function createPlanScheduler({
  run,
  delayMs = DEFAULT_DEBOUNCE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer)
} = {}) {
  if (typeof run !== 'function') {
    throw new TypeError('createPlanScheduler requires a run function');
  }

  let timer = null;
  let suspended = false;
  let runs = 0;

  const invoke = () => {
    runs += 1;
    return run();
  };

  function cancel() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /**
   * Queue a recompute. Coalesces: a burst of calls inside the debounce window
   * results in exactly one run. Returns false when the request was dropped
   * because an export is running (it will not be replayed later — the export
   * finishing re-schedules on its own).
   */
  function schedule() {
    if (suspended) return false;
    cancel();
    timer = setTimer(() => {
      timer = null;
      invoke();
    }, delayMs);
    return true;
  }

  /** Run now (used by the explicit Recalculate button and by flush-on-blur). */
  function flush() {
    if (suspended) return false;
    cancel();
    invoke();
    return true;
  }

  function suspend(value) {
    suspended = !!value;
    // Suspending drops any queued run: it would fire mid-export and stamp a
    // stale estimate over the live progress UI.
    if (suspended) cancel();
  }

  return {
    schedule,
    flush,
    cancel,
    suspend,
    isSuspended: () => suspended,
    isPending: () => timer !== null,
    runCount: () => runs
  };
}
