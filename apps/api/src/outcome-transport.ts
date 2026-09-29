/**
 * W3-003 composition hook: route outcome appends through the durable
 * OutcomeTransport port.
 *
 * The ROUTE CONTRACT IS FROZEN (POST /v1/outcomes → OutcomeEvent 200 +
 * idempotent replay + typed error envelopes — unchanged from W3-001);
 * only the internal plumbing changes: the outcome ingest handler port is
 * mounted with a transport-backed implementation instead of a direct
 * store call.
 *
 * Semantics surfaced to the route:
 * - delivered   → 200 with the sink-stored event;
 * - duplicate   → 200 with the ORIGINAL stored event (idempotencyKey
 *                 dedup collapses the re-publish to the original);
 * - buffered    → 200 with the accepted event — at-least-once delivery
 *                 continues through pump()/flush(); terminal failures
 *                 surface through failures()/onTerminalFailure, never by
 *                 dropping the event silently.
 */
import type { EventStore, OutcomeTransport, TransportClock, TransportFailure, TransportJournal } from "@reckon/events";
import { BufferedTransport, eventStoreSink } from "@reckon/events";
import type { BackoffStrategy } from "@reckon/events";
import type { OutcomeIngestHandler } from "./ports.js";

/**
 * Mount an externally-constructed OutcomeTransport behind the frozen
 * outcome route (use this when the host owns the transport lifecycle).
 */
export function transportBackedOutcomeIngest(transport: OutcomeTransport): OutcomeIngestHandler {
  return {
    ingest: async (event) => {
      const receipt = await transport.publish(event);
      if (receipt.status === "delivered" || receipt.status === "duplicate") {
        // The sink-stored record (duplicate: the ORIGINAL event).
        return receipt.event;
      }
      // Buffered (accepted, delivery in flight) — async at-least-once.
      return event;
    },
  };
}

export interface OutcomeTransportWiringOptions {
  /** The wave-1 EventStore the transport delivers into. */
  readonly store: EventStore;
  /** Injected clock — deterministic backoff and journal stamps. */
  readonly clock: TransportClock;
  /** Optional journal (default: in-memory — TEST INFRASTRUCTURE). */
  readonly journal?: TransportJournal;
  readonly backoff?: BackoffStrategy;
  readonly maxAttempts?: number;
  readonly maxBatchSize?: number;
  /** Terminal-failure surfacing (e.g. observability records). */
  readonly onTerminalFailure?: (failure: TransportFailure) => void;
}

export interface OutcomeTransportWiring {
  /** Mount as `handlers.outcomeIngest` in buildServer. */
  readonly handler: OutcomeIngestHandler;
  /** The transport instance (pump/flush/failures surface). */
  readonly transport: BufferedTransport;
}

/**
 * Compose the full outcome path: route → BufferedTransport → EventStore,
 * with an optional journal and terminal-failure surfacing. This is the
 * W3-003 wiring point for hosts and tests; main.ts keeps the honest
 * NotWired default until the production (PostgreSQL) sink lands.
 */
export function wireOutcomeTransport(options: OutcomeTransportWiringOptions): OutcomeTransportWiring {
  const transport = new BufferedTransport({
    sink: eventStoreSink(options.store),
    clock: options.clock,
    ...(options.journal !== undefined ? { journal: options.journal } : {}),
    ...(options.backoff !== undefined ? { backoff: options.backoff } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.maxBatchSize !== undefined ? { maxBatchSize: options.maxBatchSize } : {}),
    ...(options.onTerminalFailure !== undefined ? { onTerminalFailure: options.onTerminalFailure } : {}),
  });
  return { handler: transportBackedOutcomeIngest(transport), transport };
}
