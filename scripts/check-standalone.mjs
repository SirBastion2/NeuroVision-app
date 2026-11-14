import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} dir
 * @returns {{ file: string, bytes: number, html: string }}
 */
export function checkStandalone(dir) {
  const names = readdirSync(dir).filter((name) => !name.startsWith("."));
  if (names.length !== 1 || names[0] !== "index.html") {
    throw new Error(`Expected a single index.html in ${dir}, found: ${names.join(", ") || "(empty)"}`);
  }

  const file = join(dir, "index.html");
  const html = readFileSync(file, "utf8");

  const scriptSrc = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\bsrc\s*=/i.test(tag))
    .flatMap((tag) => {
      const value = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      return value ? [value[1]] : [];
    });
  const linkHref = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\bhref\s*=/i.test(tag))
    .flatMap((tag) => {
      const value = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      return value ? [value[1]] : [];
    });

  const external = [...scriptSrc, ...linkHref].filter((url) => !url.startsWith("data:"));
  if (external.length > 0) {
    throw new Error(`Standalone HTML has external script/link URLs: ${external.join(", ")}`);
  }

  return { file, bytes: statSync(file).size, html };
}
