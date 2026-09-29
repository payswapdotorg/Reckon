/**
 * ObservabilitySink port + adapters (W3-004).
 *
 * APPEND-ONLY LAW: sinks append; they never rewrite, update or remove
 * historical records (calibration law — historical evidence is
 * immutable).
 *
 * EVIDENCE LABELS: InMemoryObservabilitySink and
 * JsonlFileObservabilitySink are TEST INFRASTRUCTURE (controlled-local);
 * production telemetry backends are later waves.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalJson, contentDigest } from "@reckon/contracts";
import type { ObservabilityRecord } from "./records.js";
import { ObservabilityRecordCorruptError } from "./errors.js";

/** The sink PORT: append one immutable record. */
export interface ObservabilitySink {
  record(entry: ObservabilityRecord): void;
}

/**
 * In-memory sink — TEST INFRASTRUCTURE (controlled-local). Stores frozen
 * defensive copies; `records()` returns them in append order.
 */
export class InMemoryObservabilitySink implements ObservabilitySink {
  readonly #records: ObservabilityRecord[] = [];

  record(entry: ObservabilityRecord): void {
    this.#records.push(deepFreeze(structuredClone(entry)));
  }

  records(): readonly ObservabilityRecord[] {
    return [...this.#records];
  }

  byKind(kind: ObservabilityRecord["kind"]): readonly ObservabilityRecord[] {
    return this.#records.filter((record) => record.kind === kind);
  }

  get size(): number {
    return this.#records.length;
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Structured JSONL file sink — TEST INFRASTRUCTURE (controlled-local).
 * One canonical-JSON line per record (stable serialization); append-only.
 */
export class JsonlFileObservabilitySink implements ObservabilitySink {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  record(entry: ObservabilityRecord): void {
    appendFileSync(this.#path, `${canonicalJson(entry)}\n`, "utf8");
  }

  get path(): string {
    return this.#path;
  }

  /** Read back + digest-verify every line (test/recovery helper). */
  readAll(): readonly ObservabilityRecord[] {
    if (!existsSync(this.#path)) return [];
    const raw = readFileSync(this.#path, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line, index) => parseRecord(line, index + 1, this.#path));
  }
}

/** Parse + digest-verify one JSONL record line. */
function parseRecord(line: string, lineNumber: number, path: string): ObservabilityRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ObservabilityRecordCorruptError(`observability line ${lineNumber} is not valid JSON`, {
      lineNumber,
      path,
    });
  }
  if (typeof value !== "object" || value === null) {
    throw new ObservabilityRecordCorruptError(`observability line ${lineNumber} is not an object`, {
      lineNumber,
      path,
    });
  }
  const record = value as Record<string, unknown>;
  const { contentDigest: claimed, ...rest } = record;
  if (typeof claimed !== "string") {
    throw new ObservabilityRecordCorruptError(`observability line ${lineNumber} lacks a contentDigest`, {
      lineNumber,
      path,
    });
  }
  // Digest verification: historical evidence must not have been rewritten.
  const actual = contentDigest(rest);
  if (actual !== claimed) {
    throw new ObservabilityRecordCorruptError(
      `observability line ${lineNumber} contentDigest mismatch — record was tampered with`,
      { lineNumber, path },
    );
  }
  return record as unknown as ObservabilityRecord;
}
