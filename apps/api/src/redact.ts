const SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "csrf",
  "csrftoken",
  "x-csrf-token",
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "code_verifier",
  "client_secret",
  "password",
  "secret",
  "signedurl",
  "signed_url",
  "url",
  "upload",
  "events",
  "trials",
  "practice",
  "samples",
  "payload",
  "observations",
  "record",
  "raw",
  "bundle",
]);

function isSensitiveString(value: string): boolean {
  return (
    value.includes("X-Amz-") ||
    value.includes("X-Amz-Signature") ||
    value.includes("Signature=") ||
    value.startsWith("memory://") ||
    /[?&](code|token|signature)=/i.test(value)
  );
}

/** Drop observations, tokens, and signed URLs before anything is logged. */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted-depth]";
  if (typeof value === "string") {
    return isSensitiveString(value) ? "[redacted-url]" : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactForLog(item, depth + 1));
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        output[key] = "[redacted]";
        continue;
      }
      output[key] = redactForLog(item, depth + 1);
    }
    return output;
  }
  return value;
}
