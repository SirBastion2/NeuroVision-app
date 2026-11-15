interface Props {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

/** Top-bar Demo mode control. Off looks like Sign out; on is a highlighted pill. */
export function DemoModeToggle({ on, onToggle, disabled }: Props) {
  return (
    <button
      type="button"
      className={on ? "demo-toggle on" : "ghost demo-toggle"}
      aria-pressed={on}
      aria-label={on ? "Turn off Demo mode" : "Turn on Demo mode"}
      onClick={onToggle}
      disabled={disabled}
    >
      Demo mode
    </button>
  );
}
