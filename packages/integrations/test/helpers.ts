/**
 * W3-005/W3-006 — shared test helpers: contract-schema validation and
 * the structural "shape signature" used by the conformance proof.
 *
 * The shape signature proves SCHEMA-IDENTITY between records coming
 * from domain-different adapters: identical field paths, identical
 * value types, identical contract ids — modulo the host-opaque record
 * fields the frozen contracts themselves declare opaque
 * (attributes/constraints/extra/metrics/params — host vocabulary by
 * design). Sorted+deduplicated line sets make the comparison
 * order-insensitive and array-length-insensitive (schema identity does
 * not fix array lengths), while still failing on any missing/extra
 * field or type change.
 */

/** Minimal structural view of a zod schema's safeParse result. */
export interface Parseable<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } };
}

/** Parse a value against a frozen contract schema or fail with issues. */
export function expectValid<T>(schema: Parseable<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => JSON.stringify(issue))
      .join("; ");
    throw new Error(`contract validation failed: ${detail}`);
  }
  return parsed.data;
}

/** Assert a value FAILS the schema and return the issues (negative path). */
export function expectInvalid<T>(schema: Parseable<T>, value: unknown): { issues: unknown[] } {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    throw new Error("expected contract validation to fail, but it passed");
  }
  return { issues: parsed.error.issues };
}

/** Host-opaque record fields (per the frozen contracts: free-form
 *  records whose KEYS are host vocabulary — schema-identity cannot and
 *  must not compare their key sets). */
const OPAQUE_SUFFIXES = [".attributes", ".constraints", ".extra", ".metrics", ".params"] as const;

function isOpaquePath(path: string): boolean {
  return OPAQUE_SUFFIXES.some(
    (suffix) => path === suffix.slice(1) || path.endsWith(suffix),
  );
}

/**
 * Structural shape signature: a sorted list of `path:{shape}` lines.
 * - objects → one line for the sorted key set + one line per key
 * - arrays → one `:array` line + element signatures under `[]`
 * - primitives → `:typeof` line
 * - host-opaque record paths → a single `:opaque` line (documented)
 */
export function shapeSignature(value: unknown, path = "$"): string[] {
  if (isOpaquePath(path)) {
    return [`${path}:opaque`];
  }
  if (value === null) return [`${path}:null`];
  if (Array.isArray(value)) {
    return [
      `${path}:array`,
      ...value.flatMap((element) => shapeSignature(element, `${path}[]`)),
    ];
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return [
      `${path}:{${keys.join(",")}}`,
      ...keys.flatMap((key) => shapeSignature(record[key], `${path}.${key}`)),
    ];
  }
  return [`${path}:${typeof value}`];
}

/** Sorted+deduplicated shape signature set (order/length-insensitive). */
export function shapeSet(value: unknown): string[] {
  return Array.from(new Set(shapeSignature(value))).sort();
}

/** Assert two records are schema-identical in shape (typed failure detail). */
export function expectShapeIdentical(label: string, actual: unknown, expected: unknown): void {
  const actualShape = shapeSet(actual);
  const expectedShape = shapeSet(expected);
  const onlyActual = actualShape.filter((line) => !expectedShape.includes(line));
  const onlyExpected = expectedShape.filter((line) => !actualShape.includes(line));
  if (onlyActual.length > 0 || onlyExpected.length > 0) {
    throw new Error(
      `${label}: shape mismatch\n  only in actual: ${JSON.stringify(onlyActual)}\n  only in expected: ${JSON.stringify(onlyExpected)}`,
    );
  }
}
