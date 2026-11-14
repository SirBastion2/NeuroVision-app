import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BatteryIntro,
  BatteryIntroView,
  batteryIntroErrors,
  batteryIntroReady,
  batteryIntroStartConfig,
  resolveBatterySeed,
  type BatteryIntroConfig,
} from "../src/screens/BatteryIntro.tsx";
import { hideForBatteryMode } from "../src/data/batterySession.ts";

function config(overrides: Partial<BatteryIntroConfig> = {}): BatteryIntroConfig {
  return {
    mode: "demo",
    hide: "left",
    seed: 11,
    readingDirection: null,
    consent: false,
    ...overrides,
  };
}

function renderView(overrides: Partial<BatteryIntroConfig> = {}): string {
  return renderToStaticMarkup(
    createElement(BatteryIntroView, {
      config: config(overrides),
      onChange() {},
      onStart() {},
      onBack() {},
    }),
  );
}

describe("BatteryIntro", () => {
  it("blocks full mode without consent and reading direction", () => {
    const missing = config({ mode: "full", consent: false, readingDirection: null, hide: "left" });
    assert.equal(batteryIntroReady(missing), false);
    const errors = batteryIntroErrors(missing);
    assert.match(errors.consent ?? "", /consent/i);
    assert.match(errors.readingDirection ?? "", /reading direction/i);

    const html = renderView(missing);
    assert.match(html, /Confirm consent before starting the full battery/);
    assert.match(html, /Choose a reading direction before starting/);
    assert.match(html, /<button class="primary large" type="submit" disabled="">Start<\/button>/);
    assert.doesNotMatch(html, /name="battery-hide"/);

    const started: BatteryIntroConfig[] = [];
    renderToStaticMarkup(
      createElement(BatteryIntroView, {
        config: missing,
        onChange() {},
        onStart: (next) => started.push(next),
        onBack() {},
      }),
    );
    assert.equal(started.length, 0);

    const ready = config({ mode: "full", consent: true, readingDirection: "left-to-right", hide: "left" });
    assert.equal(batteryIntroReady(ready), true);
    assert.deepEqual(batteryIntroErrors(ready), { consent: null, readingDirection: null });
    const readyHtml = renderView(ready);
    assert.doesNotMatch(readyHtml, /Confirm consent before starting the full battery/);
    assert.doesNotMatch(readyHtml, /Choose a reading direction before starting/);
    assert.match(readyHtml, /<button class="primary large" type="submit">Start<\/button>/);
  });

  it("forces hide none in full mode", () => {
    assert.equal(hideForBatteryMode("full", "left"), "none");
    assert.equal(hideForBatteryMode("full", "right"), "none");
    assert.equal(hideForBatteryMode("demo", "left"), "left");
    assert.equal(batteryIntroStartConfig(config({ mode: "full", hide: "right" })).hide, "none");

    const html = renderView({ mode: "full", hide: "left", consent: true, readingDirection: "both-or-other" });
    assert.match(html, /Hidden side is none/);
    assert.doesNotMatch(html, /name="battery-hide"/);
    assert.match(html, /I consent to storing this battery in this browser/);
    assert.match(html, /Left to right/);
    assert.match(html, /Right to left/);
    assert.match(html, /Both or other/);
  });

  it("starts demo with the default hidden side and a seed from the URL", () => {
    assert.equal(resolveBatterySeed("?seed=42"), 42);
    assert.equal(resolveBatterySeed("seed=-3"), -3);
    assert.notEqual(resolveBatterySeed(""), 42);

    const html = renderToStaticMarkup(createElement(BatteryIntro, { onStart() {}, onBack() {} }));
    assert.match(html, /class="screen"/);
    assert.match(html, /class="page-head"/);
    assert.match(html, /class="lede"/);
    assert.match(html, /class="card"/);
    assert.match(html, /class="segmented"/);
    assert.match(html, /name="battery-hide"/);
    assert.match(html, /Left/);
    assert.match(html, /default/);
    assert.match(html, /<button class="primary large" type="submit">Start<\/button>/);
    assert.doesNotMatch(html, /I consent to storing this battery in this browser/);
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}/);
  });
});
