import { createHash } from "node:crypto";

/**
 * Deterministic canonical serialization and content digests
 * (ADR-001: deterministic canonical serialization and content digests
 * for reproducible research artifacts).
 *
 * Canonical JSON rules (RFC 8785-inspired, subset):
 * 1. Object keys sorted lexicographically (UTF-16 code units).
 * 2. No insignificant whitespace.
 * 3. Numbers: integers as-is; doubles via shortest round-trip repr.
 * 4. Strings serialized per JSON.stringify escapes.
 * 5. `undefined` values are dropped; null is kept.
 * 6. Arrays preserve order (order is semantic).
 */

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "bigint":
      return value.toString();
    case "object":
      if (value === null) return "null";
      return Array.isArray(value)
        ? serializeArray(value)
        : serializeObject(value as Record<string, unknown>);
    default:
      throw new Error(`canonicalJson: unsupported value type: ${typeof value}`);
  }
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`canonicalJson: non-finite number: ${n}`);
  }
  if (Number.isInteger(n)) return n.toString();
  // Shortest round-trip representation.
  return String(n);
}

function serializeArray(arr: unknown[]): string {
  const parts: string[] = [];
  for (const v of arr) {
    if (v === undefined) continue;
    parts.push(serialize(v));
  }
  return `[${parts.join(",")}]`;
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${JSON.stringify(k)}:${serialize(obj[k])}`);
  }
  return `{${parts.join(",")}}`;
}

/** sha256 hex digest of the canonical JSON form. */
export function contentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** sha256 hex digest of raw bytes. */
export function digestBytes(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Structural clone that drops `undefined` values so that two logically
 * equal objects serialize identically.
 */
export function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
