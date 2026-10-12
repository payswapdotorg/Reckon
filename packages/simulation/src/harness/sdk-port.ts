/**
 * createSdkPort — adapts a REAL @reckon/sdk ReckonClient into the
 * harness's ReckonPublicPort seam (SIM-001).
 *
 * This is the ONLY module in @reckon/simulation that imports another
 * workspace package besides @reckon/contracts — and it imports the
 * PUBLIC SDK (`@reckon/sdk`), never an internal kernel package. Every
 * call crossing this port is validated by the SDK itself against the
 * frozen zod contracts (request side AND response side), which is what
 * makes the conformance fixture's contract parity real rather than
 * asserted.
 *
 * Determinism note: the SDK client's default idGenerator is
 * crypto.randomUUID — NON-deterministic. Harness composition must inject
 * a deterministic generator (see `createDeterministicIdGenerator`).
 */
import type { ReckonClient } from "@reckon/sdk";
import type { ReckonPublicPort } from "./port.js";

/** Adapt a real SDK client into the harness port. */
export function createSdkPort(client: ReckonClient): ReckonPublicPort {
  return {
    decisions: {
      request: (input) => client.decisions.request(input),
    },
    outcomes: {
      append: (event) => client.outcomes.append(event),
    },
    preferences: {
      appendDelta: (delta) => client.preferences.appendDelta(delta),
    },
    catalog: {
      upsertItem: (item) => client.catalog.upsertItem(item),
      upsertRealization: (realization) => client.catalog.upsertRealization(realization),
    },
    candidates: {
      submit: (set) => client.candidates.submit(set),
    },
  };
}

/**
 * A deterministic Idempotency-Key generator for SDK clients used inside
 * the harness: `prefix-<n>` with a monotonically increasing counter.
 * Deterministic given call order (which the driver fixes).
 */
export function createDeterministicIdGenerator(prefix: string): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}
