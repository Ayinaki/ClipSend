/**
 * Unit tests for the live-plan scheduler (renderer/plan-controller.js).
 *
 * The scheduler owns only the policy around a recompute — debounce, coalescing,
 * and suspend-during-export — with timers injected, so these tests drive time by
 * hand instead of waiting on it. That policy is what keeps a trim drag from
 * firing an IPC plan call per pointer event.
 */
const { createPlanScheduler, DEFAULT_DEBOUNCE_MS } = require('../../renderer/plan-controller.js');

/** A controllable clock: the injected setTimer/clearTimer pair. */
function makeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    /** Fire every pending timer, oldest first. */
    runAll() {
      const pending = [...timers.entries()];
      timers.clear();
      pending.forEach(([, t]) => t.fn());
    },
    pendingCount() {
      return timers.size;
    },
    /** The delay the most recently scheduled timer was created with. */
    lastDelay() {
      const last = [...timers.values()].pop();
      return last ? last.ms : null;
    }
  };
}

describe('createPlanScheduler', () => {
  test('runs the recompute once after the debounce window', () => {
    const clock = makeClock();
    const run = jest.fn();
    const scheduler = createPlanScheduler({ run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    expect(scheduler.schedule()).toBe(true);
    expect(clock.pendingCount()).toBe(1);
    expect(run).not.toHaveBeenCalled();

    clock.runAll();
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.runCount()).toBe(1);
  });

  test('coalesces a burst of changes into a single run', () => {
    const clock = makeClock();
    const run = jest.fn();
    const scheduler = createPlanScheduler({ run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    // A trim drag firing many change events.
    for (let i = 0; i < 12; i++) scheduler.schedule();
    expect(clock.pendingCount()).toBe(1);

    clock.runAll();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('uses the configured debounce delay', () => {
    const clock = makeClock();
    const scheduler = createPlanScheduler({ run: jest.fn(), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    scheduler.schedule();
    expect(clock.lastDelay()).toBe(DEFAULT_DEBOUNCE_MS);
  });

  test('flush runs immediately and drops the queued run', () => {
    const clock = makeClock();
    const run = jest.fn();
    const scheduler = createPlanScheduler({ run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    scheduler.schedule();
    expect(scheduler.flush()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);

    clock.runAll();
    expect(run).toHaveBeenCalledTimes(1); // the queued run did not also fire
  });

  test('suspend drops queued work and refuses new schedules', () => {
    const clock = makeClock();
    const run = jest.fn();
    const scheduler = createPlanScheduler({ run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    scheduler.schedule();
    scheduler.suspend(true);
    expect(scheduler.isSuspended()).toBe(true);
    expect(clock.pendingCount()).toBe(0);
    expect(scheduler.schedule()).toBe(false);
    expect(scheduler.flush()).toBe(false);

    clock.runAll();
    expect(run).not.toHaveBeenCalled();

    // Resuming accepts work again.
    scheduler.suspend(false);
    expect(scheduler.schedule()).toBe(true);
    clock.runAll();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('cancel drops a pending run without invoking it', () => {
    const clock = makeClock();
    const run = jest.fn();
    const scheduler = createPlanScheduler({ run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    scheduler.schedule();
    expect(scheduler.isPending()).toBe(true);
    scheduler.cancel();
    expect(scheduler.isPending()).toBe(false);
    clock.runAll();
    expect(run).not.toHaveBeenCalled();
  });

  test('requires a run function', () => {
    expect(() => createPlanScheduler({})).toThrow(/run function/);
  });
});
