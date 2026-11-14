export const pct = (value: number | null, digits = 0) => (value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`);
export const points = (value: number | null, digits = 1) =>
  value === null ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(digits)} pts`;
export const seconds = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(2)} s`);
export const signedPct = (value: number | null) =>
  value === null ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
