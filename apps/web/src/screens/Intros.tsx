import { LINE_BISECTION_TRIAL_COUNT, type InputModality } from "@neurovision/domain";
import { Disk, Ring } from "../components/Board";
import { Eyebrow } from "../components/Brand";
import { scoredBatteryStep } from "../lib/battery-labels";
import { TIME_LIMIT_MS } from "../lib/session";

const HOW: Record<InputModality, string> = {
  "mouse-trackpad": "Click",
  touch: "Tap",
  keyboard: "Move the cursor with the arrow keys and press Enter on",
};

export function TargetIntro({
  input,
  step = scoredBatteryStep("rings"),
  onBegin,
  onCancel,
}: {
  input: InputModality;
  step?: string;
  onBegin: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="intro card narrow">
      <Eyebrow>{step}</Eyebrow>
      <h1>Find every hollow ring</h1>
      <div className="legend">
        <figure>
          <svg viewBox="0 0 60 60" aria-hidden>
            <Ring x={30} y={30} />
          </svg>
          <figcaption>
            <strong>Select</strong> hollow rings
          </figcaption>
        </figure>
        <figure>
          <svg viewBox="0 0 60 60" aria-hidden>
            <Disk x={30} y={30} />
          </svg>
          <figcaption>
            <strong>Leave</strong> solid disks
          </figcaption>
        </figure>
      </div>
      <ul className="steps">
        <li>{HOW[input]} each hollow ring once.</li>
        <li>Search the whole board at your own pace. You have up to {TIME_LIMIT_MS["target-selection"] / 1000} seconds.</li>
        <li>Press Done when you think you have found them all.</li>
        <li>Switching tabs or resizing the window stops the task.</li>
      </ul>
      <div className="actions">
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary large" onClick={onBegin} autoFocus>
          Start hollow rings
        </button>
      </div>
    </section>
  );
}

export function LineIntro({
  input,
  step = scoredBatteryStep("lines"),
  lineCount = LINE_BISECTION_TRIAL_COUNT,
  onBegin,
}: {
  input: InputModality;
  step?: string;
  lineCount?: number;
  onBegin: () => void;
}) {
  return (
    <section className="intro card narrow">
      <Eyebrow>{step}</Eyebrow>
      <h1>Mark the middle of each line</h1>
      <svg className="line-example" viewBox="0 0 300 60" aria-hidden>
        <line x1={30} x2={270} y1={30} y2={30} className="bisection-line" />
        <line x1={150} x2={150} y1={14} y2={46} className="tick" />
      </svg>
      <ul className="steps">
        <li>
          {HOW[input]} the point you judge to be the centre. One mark per line, {lineCount} lines in total.
        </li>
        <li>There is no feedback on accuracy. Press Next line to continue, or Skip line.</li>
        <li>Each line has up to {TIME_LIMIT_MS["line-bisection"] / 1000} seconds.</li>
      </ul>
      <div className="actions">
        <button className="primary large" onClick={onBegin} autoFocus>
          Start line bisection
        </button>
      </div>
    </section>
  );
}
