import { useMemo, useState } from "react";
import {
  DEFAULT_NORMS,
  combineEvidence,
  generateScene,
  greyscalesNormFor,
  parseBatteryRecord,
  scoreBatteryRecord,
  sessionSourceLabel,
  type BatteryRecord,
  type EvidenceResult,
  type Hypothesis,
  type Scene,
  type TestEvidence,
  type TestId,
  type TestNorm,
  type TestObservation,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { Stat } from "../components/ReviewFigures";
import { dateTime } from "../lib/format";

interface Props {
  record: BatteryRecord;
  onExport: () => void;
  onBack: () => void;
}

const HYPOTHESIS_LABEL: Record<Hypothesis, string> = {
  none: "Balanced",
  left: "Left weaker",
  right: "Right weaker",
};

const BAR_FILL: Record<Hypothesis, string> = {
  left: "var(--missed)",
  none: "var(--found)",
  right: "var(--brass)",
};

export function batteryNorms(record: BatteryRecord): Partial<Record<TestId, TestNorm>> {
  const norms: Partial<Record<TestId, TestNorm>> = { ...record.normsUsed };
  if (record.readingDirection && norms.greyscales === undefined) {
    norms.greyscales = greyscalesNormFor(record.readingDirection);
  }
  return norms;
}

function sameNorm(a: TestNorm, b: TestNorm): boolean {
  return a.mean === b.mean && a.healthySd === b.healthySd && a.sensitivity === b.sensitivity && a.source === b.source;
}

/** True when a counted test fell back to DEFAULT_NORMS (or stored a copy of them). */
export function usedDefaultNorms(record: BatteryRecord, evidence: EvidenceResult): boolean {
  return evidence.tests.some((row) => {
    if (!row.included) return false;
    const stored = record.normsUsed[row.test];
    if (stored) return sameNorm(stored, DEFAULT_NORMS[row.test]);
    if (row.test === "greyscales" && record.readingDirection) return false;
    return true;
  });
}

function isUncalibratedRow(row: TestEvidence): boolean {
  return row.normSource === "uncalibrated";
}

export function serializeBatteryRecord(record: BatteryRecord): string {
  return JSON.stringify(parseBatteryRecord(record), null, 2);
}

export function batteryDisplay(record: BatteryRecord, patientExample = false) {
  const scored = scoreBatteryRecord(record);
  const scene = generateScene({ seed: record.seed, hide: record.hide });
  const induced = scored.scene.observationInduced;
  const sceneRan = record.scene.taps.length > 0;
  const observations: TestObservation[] = [];
  if (sceneRan) {
    if (patientExample && induced) observations.push(induced);
    else observations.push(scored.scene.observationVisible);
  }
  observations.push(scored.clock.observation);
  if (scored.greyscales) observations.push(scored.greyscales.observation);
  if (scored.bisection) observations.push(scored.bisection.observation);

  const evidence = combineEvidence(observations, batteryNorms(record), patientExample && induced ? { includeInduced: true } : {});
  const counted = evidence.tests.filter((row) => row.included);
  const ledger = evidence.tests;
  return {
    scene,
    scored,
    evidence,
    observations,
    counted,
    ledger,
    hasInduced: induced != null,
    sceneRan,
    usedDefaultNorms: usedDefaultNorms(record, evidence),
    usedUncalibratedNorms: evidence.usesUncalibratedNorms,
  };
}

function formatLean(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0.00";
  const digits = Math.abs(value).toFixed(2);
  return value > 0 ? `+${digits}` : `-${digits}`;
}

function formatIndex(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0.00";
  const digits = Math.abs(value).toFixed(2);
  return value > 0 ? `+${digits}` : `-${digits}`;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function contributionText(row: TestEvidence): string {
  if (isUncalibratedRow(row)) return "Uncalibrated — no published healthy range";
  const times = row.factor >= 10 ? row.factor.toFixed(0) : row.factor.toFixed(1);
  if (row.favors === "none") return `Supports a balanced reading (${times}×)`;
  if (row.favors === "left") return `Points to the left side (${times}×)`;
  return `Points to the right side (${times}×)`;
}

function downloadRecord(record: BatteryRecord): void {
  const url = URL.createObjectURL(new Blob([serializeBatteryRecord(record)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: `${record.id}.json` }).click();
  URL.revokeObjectURL(url);
}

function SceneMap({ scene, foundIds }: { scene: Scene; foundIds: readonly string[] }) {
  const found = new Set(foundIds);
  const targets = scene.lanterns.filter((lantern) => lantern.lit);
  return (
    <figure className="plot">
      <svg
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        role="img"
        aria-label="Scene map with found lanterns, missed lanterns, and the hidden region shaded"
      >
        <rect x={0} y={0} width={scene.width} height={scene.height} fill="var(--surface)" />
        {scene.moon ? <circle cx={scene.moon.x} cy={scene.moon.y} r={scene.moon.r} fill="var(--brass)" opacity={0.45} /> : null}
        {scene.buildings.map((building, index) => (
          <rect
            key={`b-${index}`}
            x={building.x}
            y={scene.groundY - building.h}
            width={building.w}
            height={building.h}
            fill="var(--ink-2)"
            opacity={0.18}
          />
        ))}
        {scene.posts.map((x, index) => (
          <rect key={`p-${index}`} x={x - 2} y={scene.groundY - 70} width={4} height={70} fill="var(--line)" />
        ))}
        <rect
          x={scene.lighthouse.x - 10}
          y={scene.lighthouse.baseY - scene.lighthouse.h}
          width={20}
          height={scene.lighthouse.h}
          fill="var(--accent)"
          opacity={0.35}
        />
        <line x1={0} x2={scene.width} y1={scene.groundY} y2={scene.groundY} stroke="var(--line)" strokeWidth={6} />
        {scene.hidden ? (
          <rect
            x={scene.hidden.x0}
            y={0}
            width={scene.hidden.x1 - scene.hidden.x0}
            height={scene.height}
            fill="var(--muted)"
            opacity={0.28}
          />
        ) : null}
        {targets.map((lantern) => {
          const hit = found.has(lantern.id);
          return (
            <circle
              key={lantern.id}
              cx={lantern.x}
              cy={lantern.y}
              r={16}
              fill={hit ? "var(--found)" : "none"}
              stroke={hit ? "var(--found)" : "var(--missed)"}
              strokeWidth={5}
              strokeDasharray={hit ? undefined : "8 7"}
            >
              <title>{hit ? `Found lantern ${lantern.id}` : `Missed lantern ${lantern.id}`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="plot-legend">
        <span>
          <i className="key" /> Found
        </span>
        <span>
          <i className="key missed" /> Missed
        </span>
        <span>Hidden region shaded</span>
      </figcaption>
    </figure>
  );
}

export function BatteryResults({ record, onExport, onBack }: Props) {
  const [patientExample, setPatientExample] = useState(false);
  const display = useMemo(() => batteryDisplay(record, patientExample), [record, patientExample]);
  const { evidence, counted, ledger, scene, scored, hasInduced, sceneRan } = display;
  const posteriors: Array<{ key: Hypothesis; pct: number }> = [
    { key: "left", pct: percent(evidence.posterior.left) },
    { key: "none", pct: percent(evidence.posterior.none) },
    { key: "right", pct: percent(evidence.posterior.right) },
  ];
  const observationByTest = new Map(display.observations.map((item) => [item.test, item]));
  const leanWords = `Lean estimate ${formatLean(evidence.lean.mean)}, 90% range ${formatLean(evidence.lean.lo)} to ${formatLean(evidence.lean.hi)}, in units of normal person-to-person variation; negative means the left side is weaker.`;

  const exportJson = () => {
    downloadRecord(record);
    onExport();
  };

  return (
    <div className="screen">
      <div>
        <header className="page-head">
          <div>
            <Eyebrow>Battery results</Eyebrow>
            <h1>Combined reading</h1>
            <p className="lede">
              {dateTime(record.completedAt)} · {record.mode === "full" ? "Full battery" : "Short battery"} · {counted.length} counted
              tests
            </p>
          </div>
          <div className="actions">
            <label className={`check ${hasInduced ? "" : "disabled"}`}>
              <input
                type="checkbox"
                checked={patientExample && hasInduced}
                disabled={!hasInduced}
                onChange={(event) => setPatientExample(event.target.checked)}
              />
              Show patient example
            </label>
            <button className="ghost" type="button" onClick={exportJson}>
              Export JSON
            </button>
            <button type="button" onClick={onBack}>
              Back
            </button>
          </div>
        </header>

        <section className="verdict card">
          <div className="verdict-text">
            <Eyebrow plain>Verdict</Eyebrow>
            <h2>{evidence.verdict.text}</h2>
            <p>{leanWords}</p>
          </div>
        </section>

        <section className="stat-row">
          <Stat label="Lean estimate" value={formatLean(evidence.lean.mean)} sub="person-to-person units" />
          <Stat
            label="90% range"
            value={`${formatLean(evidence.lean.lo)} to ${formatLean(evidence.lean.hi)}`}
            sub="negative = left weaker"
          />
          <Stat label="Counted tests" value={String(counted.length)} />
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Lean across hypotheses</h3>
            <span className="small">Left weaker, balanced, and right weaker</span>
          </div>
          <div
            className="balance"
            role="img"
            aria-label={`Left weaker ${posteriors[0]!.pct} percent, balanced ${posteriors[1]!.pct} percent, right weaker ${posteriors[2]!.pct} percent`}
          >
            <div className="balance-track" style={{ gridColumn: "1 / -1", width: "100%", borderRadius: 6 }}>
              {posteriors.map((item) => (
                <div
                  key={item.key}
                  className="balance-fill"
                  style={{ width: `${item.pct}%`, background: BAR_FILL[item.key] }}
                />
              ))}
            </div>
          </div>
          <div className="legend">
            {posteriors.map((item) => (
              <figure key={item.key}>
                <svg viewBox="0 0 60 60" aria-hidden>
                  <rect x="8" y="8" width="44" height="44" rx="10" fill={BAR_FILL[item.key]} />
                </svg>
                <figcaption>
                  <strong>{HYPOTHESIS_LABEL[item.key]}</strong> {item.pct}%
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Ledger</h3>
            <span className="small">Lateral index: negative means the left side is weaker. Uncalibrated tests are shown but not scored against norms.</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Test</th>
                <th>Lateral index</th>
                <th>Contribution</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => {
                const observation = observationByTest.get(row.test);
                return (
                  <tr key={`${row.test}-${row.label}`}>
                    <td>{row.label}</td>
                    <td>{observation ? formatIndex(observation.value) : formatIndex(row.z)}</td>
                    <td>{contributionText(row)}</td>
                    <td>
                      {isUncalibratedRow(row) ? (
                        <span className="badge incomplete">Uncalibrated</span>
                      ) : row.discordant ? (
                        <span className="badge incomplete">Disagrees</span>
                      ) : (
                        <span className="small">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card pad-0">
          <div className="card-head">
            <h3>Scene map</h3>
            <span className="small">
              {sceneRan
                ? `${scored.scene.foundVisible} of ${scored.scene.visibleTargets} visible lanterns found`
                : "Scene search was skipped for this run"}
            </span>
          </div>
          {sceneRan ? (
            <SceneMap scene={scene} foundIds={scored.scene.foundIds} />
          ) : (
            <p className="notice">Scene search is a placeholder in the step order and was not run.</p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Notes</h3>
          </div>
          <div className="stats">
            <p className="notice">Screening aid, not a diagnosis</p>
            {display.usedUncalibratedNorms ? (
              <p className="notice warn">Some tests have no published healthy range and were not scored against norms.</p>
            ) : null}
            {record.source === "demonstration" ? (
              <p className="notice">
                <span className="badge demonstration">{sessionSourceLabel(record.source)}</span> This record is a demonstration.
              </p>
            ) : null}
            {evidence.notes
              .filter((note) => !note.includes("no published healthy range") && !note.includes("on purpose"))
              .map((note) => (
                <p key={note} className="notice warn">
                  {note}
                </p>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
