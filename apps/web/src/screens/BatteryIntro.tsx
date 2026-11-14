import { useMemo, useState, type FormEvent } from "react";
import { BATTERY_MODES, type BatteryMode, type HideSide, type ReadingDirection } from "@neurovision/domain";
import { hideForBatteryMode, type BatteryIntroConfig } from "../data/batterySession";
import { Eyebrow } from "../components/Brand";

export type { BatteryIntroConfig };

interface Props {
  onStart: (config: BatteryIntroConfig) => void;
  onBack: () => void;
}

const HIDE_SIDES: readonly HideSide[] = ["left", "right", "none"];
const READING_DIRECTIONS: readonly ReadingDirection[] = ["left-to-right", "right-to-left", "both-or-other"];

const MODE_LABEL: Record<BatteryMode, string> = {
  demo: "Short demo",
  full: "Full battery",
};

const HIDE_LABEL: Record<HideSide, string> = {
  left: "Left",
  right: "Right",
  none: "None",
};

const READING_LABEL: Record<ReadingDirection, string> = {
  "left-to-right": "Left to right",
  "right-to-left": "Right to left",
  "both-or-other": "Both or other",
};

export function randomBatterySeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** Seed from `?seed=` when it is an integer; otherwise a random int. */
export function resolveBatterySeed(search = ""): number {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(query).get("seed");
  if (raw != null && /^-?\d+$/.test(raw)) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return randomBatterySeed();
}

export function batteryIntroReady(
  config: Pick<BatteryIntroConfig, "mode" | "consent" | "readingDirection">,
): boolean {
  if (config.mode === "demo") return true;
  return config.consent === true && config.readingDirection != null;
}

export function batteryIntroErrors(
  config: Pick<BatteryIntroConfig, "mode" | "consent" | "readingDirection">,
): { consent: string | null; readingDirection: string | null } {
  if (config.mode !== "full") return { consent: null, readingDirection: null };
  return {
    consent: config.consent ? null : "Confirm consent before starting the full battery.",
    readingDirection: config.readingDirection ? null : "Choose a reading direction before starting.",
  };
}

export function batteryIntroStartConfig(config: BatteryIntroConfig): BatteryIntroConfig {
  return { ...config, hide: hideForBatteryMode(config.mode, config.hide) };
}

function currentSearch(): string {
  try {
    return typeof window !== "undefined" ? window.location.search : "";
  } catch {
    return "";
  }
}

export interface BatteryIntroViewProps {
  config: BatteryIntroConfig;
  onChange: (next: BatteryIntroConfig) => void;
  onStart: (config: BatteryIntroConfig) => void;
  onBack: () => void;
}

export function BatteryIntroView({ config, onChange, onStart, onBack }: BatteryIntroViewProps) {
  const hide = hideForBatteryMode(config.mode, config.hide);
  const ready = batteryIntroReady(config);
  const errors = batteryIntroErrors(config);
  const startConfig = batteryIntroStartConfig({ ...config, hide });

  const patch = (partial: Partial<BatteryIntroConfig>) => {
    const mode = partial.mode ?? config.mode;
    onChange({
      ...config,
      ...partial,
      mode,
      hide: hideForBatteryMode(mode, partial.hide ?? config.hide),
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onStart(startConfig);
  };

  return (
    <div className="screen">
      <div>
        <header className="page-head">
          <div>
            <Eyebrow>Spatial battery</Eyebrow>
            <h1>Choose how to run the battery</h1>
            <p className="lede">
              A short demo covers scene search and the clock check. The full battery adds greyscales and line
              bisection, and asks for consent and reading direction first.
            </p>
          </div>
        </header>

        <form className="card" onSubmit={submit}>
          <fieldset className="field">
            <legend>Mode</legend>
            <div className="segmented" role="radiogroup" aria-label="Battery mode">
              {BATTERY_MODES.map((mode) => (
                <label key={mode} className={config.mode === mode ? "on" : ""}>
                  <input
                    type="radio"
                    name="battery-mode"
                    value={mode}
                    checked={config.mode === mode}
                    onChange={() => patch({ mode })}
                  />
                  {MODE_LABEL[mode]}
                </label>
              ))}
            </div>
          </fieldset>

          {config.mode === "demo" ? (
            <fieldset className="field">
              <legend>Hidden scene side</legend>
              <div className="segmented" role="radiogroup" aria-label="Hidden scene side">
                {HIDE_SIDES.map((side) => (
                  <label key={side} className={hide === side ? "on" : ""}>
                    <input
                      type="radio"
                      name="battery-hide"
                      value={side}
                      checked={hide === side}
                      onChange={() => patch({ hide: side })}
                    />
                    {HIDE_LABEL[side]}
                    {side === "left" ? <small> · default</small> : null}
                  </label>
                ))}
              </div>
              <p className="notice">The hidden side is revealed after the search. Full runs show the whole scene.</p>
            </fieldset>
          ) : (
            <p className="notice">The full battery shows the whole scene. Hidden side is none.</p>
          )}

          {config.mode === "full" ? (
            <>
              <fieldset className="field">
                <legend>Consent</legend>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={config.consent}
                    aria-invalid={errors.consent != null}
                    aria-describedby={errors.consent ? "battery-consent-error" : undefined}
                    onChange={(event) => patch({ consent: event.target.checked })}
                  />
                  I consent to storing this battery in this browser.
                </label>
                {errors.consent ? (
                  <p id="battery-consent-error" className="notice error" role="alert">
                    {errors.consent}
                  </p>
                ) : null}
              </fieldset>

              <fieldset className="field">
                <legend>Reading direction</legend>
                <div className="segmented" role="radiogroup" aria-label="Reading direction">
                  {READING_DIRECTIONS.map((direction) => (
                    <label key={direction} className={config.readingDirection === direction ? "on" : ""}>
                      <input
                        type="radio"
                        name="battery-reading"
                        value={direction}
                        checked={config.readingDirection === direction}
                        aria-invalid={errors.readingDirection != null}
                        aria-describedby={errors.readingDirection ? "battery-reading-error" : undefined}
                        onChange={() => patch({ readingDirection: direction })}
                      />
                      {READING_LABEL[direction]}
                    </label>
                  ))}
                </div>
                {errors.readingDirection ? (
                  <p id="battery-reading-error" className="notice error" role="alert">
                    {errors.readingDirection}
                  </p>
                ) : null}
              </fieldset>
            </>
          ) : null}

          <p className="fineprint">Screening aid, not a diagnosis. Records stay in this browser.</p>

          <div className="actions">
            <button className="ghost" type="button" onClick={onBack}>
              Back
            </button>
            <button className="primary large" type="submit" disabled={!ready}>
              Start
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BatteryIntro({ onStart, onBack }: Props) {
  const seed = useMemo(() => resolveBatterySeed(currentSearch()), []);
  const [config, setConfig] = useState<BatteryIntroConfig>({
    mode: "demo",
    hide: "left",
    seed,
    readingDirection: null,
    consent: false,
  });

  return <BatteryIntroView config={config} onChange={setConfig} onStart={onStart} onBack={onBack} />;
}
