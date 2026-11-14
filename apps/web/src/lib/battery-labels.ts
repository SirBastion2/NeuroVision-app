/** Scored battery in nav order. Hidden scene is an unscored demo and is not listed. */
export const SCORED_BATTERY = [
  {
    id: "starry",
    name: "Starry Night",
    blurb: "Press whenever a red dot flashes among blinking green ones.",
  },
  {
    id: "rings",
    name: "Hollow rings",
    blurb: "Find hollow rings among solid disks on a fixed board.",
  },
  {
    id: "lines",
    name: "Line bisection",
    blurb: "Mark the centre of five lines. No feedback.",
  },
] as const;

export type ScoredBatteryTest = (typeof SCORED_BATTERY)[number]["id"];

export const SCORED_BATTERY_COUNT = SCORED_BATTERY.length;

export function scoredBatteryName(test: ScoredBatteryTest): string {
  const found = SCORED_BATTERY.find((item) => item.id === test);
  if (!found) throw new Error(`Unknown scored battery test: ${test}`);
  return found.name;
}

/** Always `Test N of 3 · Name` using the full battery, even when a test is opened on its own. */
export function scoredBatteryStep(test: ScoredBatteryTest): string {
  const index = SCORED_BATTERY.findIndex((item) => item.id === test);
  if (index < 0) throw new Error(`Unknown scored battery test: ${test}`);
  return `Test ${index + 1} of ${SCORED_BATTERY_COUNT} · ${SCORED_BATTERY[index]!.name}`;
}

export function scoredBatteryStepIndex(test: ScoredBatteryTest): number {
  return SCORED_BATTERY.findIndex((item) => item.id === test) + 1;
}

/** Home journey: scored tests in nav order, then review. */
export const HOME_JOURNEY_STEPS = [
  ...SCORED_BATTERY.map((test, index) => ({
    n: String(index + 1).padStart(2, "0"),
    title: test.name,
    text: test.blurb,
  })),
  {
    n: String(SCORED_BATTERY_COUNT + 1).padStart(2, "0"),
    title: "Review",
    text: "See what was found, what was missed, and where.",
  },
] as const;
