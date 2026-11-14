/** Shared helpers for check results. Clock and greyscales screens were removed with the spatial battery. */

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
export const fileStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** Left and right counts growing out from the midline, in the same balance bar as the session review. */
export function Balance({
  left,
  right,
  leftLabel,
  rightLabel,
  total,
  aria,
}: {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
  total: number;
  aria: string;
}) {
  const side = (label: string, n: number, cls: string) => (
    <div className={`balance-side ${cls}`}>
      <div className="balance-track">
        <div className="balance-fill" style={{ width: `${total ? (100 * n) / total : 0}%` }} />
      </div>
      <div className="balance-label">
        <span>{label}</span>
        <strong>
          {n}
          <small> / {total}</small>
        </strong>
      </div>
    </div>
  );
  return (
    <div className="balance" role="img" aria-label={aria}>
      {side(leftLabel, left, "left")}
      <span className="balance-mid" aria-hidden />
      {side(rightLabel, right, "right")}
    </div>
  );
}
