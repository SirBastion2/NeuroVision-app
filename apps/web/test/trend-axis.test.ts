import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrendChart } from "../src/components/TrendChart.tsx";
import { date, time } from "../src/lib/format.ts";
import {
  estimateTrendLabelWidth,
  trendAxisTicks,
  trendDayKey,
  trendLabelBounds,
  trendPointX,
  trendTickAnchor,
} from "../src/lib/trend-axis.ts";

const INNER = 446;
const PAD_LEFT = 46;

function iso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function xFor(count: number) {
  return (index: number) => trendPointX(index, count, INNER, PAD_LEFT);
}

function boxes(ticks: ReturnType<typeof trendAxisTicks>, count: number, gap = 12) {
  return ticks.map((tick) => {
    const box = trendLabelBounds(tick.x, estimateTrendLabelWidth(tick.text), trendTickAnchor(tick.index, count));
    return { ...box, gap };
  });
}

function assertNoOverlap(ticks: ReturnType<typeof trendAxisTicks>, count: number) {
  const laid = boxes(ticks, count);
  for (let i = 1; i < laid.length; i++) {
    assert.ok(
      laid[i]!.left >= laid[i - 1]!.right + laid[i]!.gap,
      `overlap between "${ticks[i - 1]?.text}" and "${ticks[i]?.text}"`,
    );
  }
}

describe("trend axis labels", () => {
  it("shows the date once per local day and the time for later same-day sessions", () => {
    const timestamps = [iso(2026, 11, 14, 10, 0), iso(2026, 11, 14, 12, 5), iso(2026, 11, 14, 19, 12)];
    const ticks = trendAxisTicks(timestamps, xFor(timestamps.length), {
      formatDate: date,
      formatTime: time,
    });
    assert.equal(ticks.length, 3);
    assert.deepEqual(
      ticks.map((t) => t.text),
      [date(timestamps[0]!), time(timestamps[1]!), time(timestamps[2]!)],
    );
    assert.equal(ticks[0]!.text, date(timestamps[0]!));
    assert.notEqual(ticks[1]!.text, ticks[0]!.text);
  });

  it("keeps a date label on each new day, even when a same-day session follows", () => {
    const timestamps = [iso(2026, 11, 1, 10), iso(2026, 11, 8, 10), iso(2026, 11, 14, 10), iso(2026, 11, 14, 19, 12)];
    const ticks = trendAxisTicks(timestamps, xFor(timestamps.length), {
      formatDate: (value) => `D:${trendDayKey(value)}`,
      formatTime: (value) => `T:${new Date(value).getHours()}`,
    });
    assert.deepEqual(
      ticks.map((t) => t.text),
      [
        `D:${trendDayKey(timestamps[0]!)}`,
        `D:${trendDayKey(timestamps[1]!)}`,
        `D:${trendDayKey(timestamps[2]!)}`,
        `T:${new Date(timestamps[3]!).getHours()}`,
      ],
    );
  });

  it("places points evenly by session order, not by calendar gap", () => {
    const xs = [0, 1, 2, 3].map((i) => trendPointX(i, 4, INNER, PAD_LEFT));
    const step = xs[1]! - xs[0]!;
    assert.equal(xs[0], PAD_LEFT);
    assert.equal(xs[3], PAD_LEFT + INNER);
    assert.ok(Math.abs(xs[2]! - xs[1]! - step) < 1e-9);
  });

  it("thins labels so the last two sessions never stack at the right edge", () => {
    const timestamps = Array.from({ length: 8 }, (_, i) => iso(2026, 11, 14, 8 + i, 12));
    const ticks = trendAxisTicks(timestamps, xFor(timestamps.length), {
      formatDate: () => "Nov 14, 2026",
      formatTime: () => "7:12 PM",
    });
    const indices = ticks.map((t) => t.index);
    assert.equal(indices[0], 0);
    assert.equal(indices[indices.length - 1], 7);
    assert.equal(indices.includes(6) && indices.includes(7), false);
    assertNoOverlap(ticks, timestamps.length);
    assert.equal(ticks[0]!.text, "Nov 14, 2026");
    assert.ok(ticks.slice(1).every((t) => t.text === "7:12 PM"));
  });

  it("promotes a later same-day tick to the date when the day's first point is thinned away", () => {
    const timestamps = [
      iso(2026, 11, 14, 8),
      iso(2026, 11, 14, 9),
      iso(2026, 11, 14, 10),
      iso(2026, 11, 15, 8),
      iso(2026, 11, 15, 9),
      iso(2026, 11, 15, 10),
      iso(2026, 11, 16, 8),
      iso(2026, 11, 16, 9),
    ];
    const ticks = trendAxisTicks(timestamps, xFor(timestamps.length), {
      formatDate: (value) => `D:${trendDayKey(value)}`,
      formatTime: () => "T",
      charWidth: 20,
    });
    const byDay = new Map<string, string[]>();
    for (const tick of ticks) {
      const day = trendDayKey(timestamps[tick.index]!);
      const seen = byDay.get(day) ?? [];
      seen.push(tick.text);
      byDay.set(day, seen);
    }
    for (const [day, texts] of byDay) {
      assert.equal(texts[0], `D:${day}`);
      assert.ok(texts.slice(1).every((text) => text === "T"));
    }
    assertNoOverlap(ticks, timestamps.length);
  });
});

describe("TrendChart x-axis", () => {
  it("renders compact, non-overlapping labels for same-day sessions", () => {
    const timestamps = Array.from({ length: 8 }, (_, i) => iso(2026, 11, 14, 8 + i, 12));
    const html = renderToStaticMarkup(
      createElement(TrendChart, {
        title: "Targets found",
        min: 0,
        max: 1,
        format: (v) => `${v}`,
        points: timestamps.map((at, i) => ({
          id: `s${i}`,
          at,
          label: date(at),
          value: 1,
        })),
      }),
    );
    const labels = [...html.matchAll(/class="x-label"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
    const expected = trendAxisTicks(timestamps, xFor(timestamps.length)).map((t) => t.text);
    assert.deepEqual(labels, expected);
    assert.ok(labels.length >= 2);
    assert.equal(labels[0], date(timestamps[0]!));
    assert.ok(labels.slice(1).every((text) => text !== date(timestamps[0]!)));
  });
});
