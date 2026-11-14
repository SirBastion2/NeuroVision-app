export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function parseFail(label: string): never {
  throw new Error(`Cannot parse an invalid ${label}.`);
}
