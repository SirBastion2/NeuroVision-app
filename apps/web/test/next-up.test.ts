import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextUp } from "../src/checks/pages.tsx";
import {
  NEXT_UP_ADVANCE_MS,
  NEXT_UP_CONTINUE_MS,
  armNextUpAdvance,
  armNextUpAdvanceOnCallbackIdentity,
  type NextUpTimerId,
  type NextUpTimers,
} from "../src/checks/next-up.ts";

/**
 * Fake clock used to reproduce the stuck "Up next" card: the CSS bar is 1.8s
 * (`both`) and does not restart, while a JS timeout that is cleared on every
 * parent re-render never fires.
 */
function createFakeTimers(): NextUpTimers & { tick: (ms: number) => void; now: () => number } {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id as NextUpTimerId;
    },
    clearTimeout(id) {
      pending.delete(id as unknown as number);
    },
    tick(ms) {
      now += ms;
      const due = [...pending.entries()].filter(([, item]) => item.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, item] of due) {
        pending.delete(id);
        item.fn();
      }
    },
  };
}

describe("Up next interstitial", () => {
  it("reproduces the stuck card when the timer is tied to onGo identity", () => {
    const timers = createFakeTimers();
    let calls = 0;
    let cancel = armNextUpAdvanceOnCallbackIdentity(() => {
      calls += 1;
    }, timers);

    // App re-renders while the card is up (session save, upload queue, auth,
    // StrictMode) pass a new inline onGo. Each one clears the 2.6s timeout.
    // The CSS bar has already finished (1.8s, fill-mode both) and does not restart.
    for (let elapsed = 0; elapsed < 10_000; elapsed += 500) {
      timers.tick(500);
      cancel();
      cancel = armNextUpAdvanceOnCallbackIdentity(() => {
        calls += 1;
      }, timers);
    }

    assert.equal(calls, 0, "next test never starts: timeout is cleared faster than 2.6s");
    cancel();
  });

  it("auto-advances once even when onGo identity changes every render", () => {
    const timers = createFakeTimers();
    let calls = 0;
    const onGoRef = {
      current: () => {
        calls += 1;
      },
    };
    const stop = armNextUpAdvance(() => onGoRef.current(), () => undefined, timers);

    for (let elapsed = 0; elapsed < NEXT_UP_ADVANCE_MS; elapsed += 400) {
      onGoRef.current = () => {
        calls += 1;
      };
      timers.tick(400);
    }
    timers.tick(NEXT_UP_ADVANCE_MS);

    assert.equal(calls, 1);
    stop();
  });

  it("re-arms after StrictMode cleanup instead of leaving the timeout cleared", () => {
    const timers = createFakeTimers();
    let calls = 0;
    const go = () => {
      calls += 1;
    };
    const first = armNextUpAdvance(go, () => undefined, timers);
    first();
    assert.equal(calls, 0);

    const second = armNextUpAdvance(go, () => undefined, timers);
    timers.tick(NEXT_UP_ADVANCE_MS);
    assert.equal(calls, 1);
    second();
  });

  it("does not wait on a hanging save/upload before advancing", () => {
    const timers = createFakeTimers();
    let advanced = false;
    const hangingSave = new Promise<void>(() => {
      /* never settles — the old risk if advance awaited store.save / /api */
    });
    const stop = armNextUpAdvance(
      () => {
        void hangingSave;
        advanced = true;
      },
      () => undefined,
      timers,
    );
    timers.tick(NEXT_UP_ADVANCE_MS);
    assert.equal(advanced, true);
    stop();
  });

  it("shows the Continue fallback at 5s if the card is still mounted", () => {
    const timers = createFakeTimers();
    let continued = false;
    const stop = armNextUpAdvance(
      () => undefined,
      () => {
        continued = true;
      },
      timers,
    );
    timers.tick(NEXT_UP_ADVANCE_MS);
    assert.equal(continued, false);
    timers.tick(NEXT_UP_CONTINUE_MS - NEXT_UP_ADVANCE_MS);
    assert.equal(continued, true);
    stop();
  });

  it("keeps the Up next card markup and omits Continue until the fallback", () => {
    const html = renderToStaticMarkup(
      createElement(NextUp, {
        name: "Line bisection",
        hint: "Mark the middle of each line. 5 lines, one mark each.",
        onGo() {},
      }),
    );
    assert.match(html, /Up next/);
    assert.match(html, /Line bisection/);
    assert.match(html, /next-up-bar/);
    assert.doesNotMatch(html, />Continue</);
  });
});
