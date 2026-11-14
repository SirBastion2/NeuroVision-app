import { createHash, timingSafeEqual } from "node:crypto";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof value === "string") hash.update(value);
  else hash.update(value);
  return hash.digest("hex");
}

export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
