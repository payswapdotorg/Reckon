/**
 * S2-002 — webhook event EMISSION SEAM.
 *
 * Builds ON the @reckon/events backbone (never forks it): the domain
 * records that already flow through this package (OutcomeEvent through
 * the outcome transport, PreferenceDelta through the ingest port,
 * DecisionResult through the decision path) are mapped HERE into the
 * THIN webhook events frozen in @reckon/contracts/webhooks.ts, and
 * published through the ReckonEventPublisher port.
 *
 * Laws (mirroring the events backbone):
 * - THIN BY CONSTRUCTION: mappers only reference ids + timestamps +
 *   scalar summary fields from the domain record — never embed a full
 *   contract record.
 * - NO INVENTED VALUES: a mapper returns null when the domain record
 *   does not carry the anchors the documented payload requires (e.g. a
 *   schedule delta without a resolvable planId, an outcome without the
 *   decision it confirms). Callers skip emission on null — a thin event
 *   must never carry fabricated fields.
 * - DETERMINISTIC: event ids and `created` are caller-injected (id
 *   generator + clock at the composition root — the same authority
 *   split as every other timestamp in the repo).
 * - VALIDATED: every constructed event passes ReckonEventSchema before
 *   it leaves this module (typed EventsError otherwise).
 */
import {
  ReckonEventSchema,
  type DecisionResult,
  type OutcomeEvent,
  type PreferenceDelta,
  type ReckonEvent,
  type TenantScope,
  type WebhookEventType,
} from "@reckon/contracts";
import { EventValidationError, toValidationIssues } from "./errors.js";

/* ------------------------------------------------------------------ *
 * The publisher port                                                    *
 * ------------------------------------------------------------------ */

/**
 * The emission port the domain paths publish thin events through. The
 * webhook delivery engine (apps/api) implements it; anything else
 * (tests, alternative buses) can too. `publish` MUST be total: an
 * implementation records delivery failures in its delivery log and
 * never lets them escape into the emitting domain path.
 */
export interface ReckonEventPublisher {
  publish(event: ReckonEvent): void | Promise<void>;
}

/** A publisher that drops every event (the default when no bus is wired). */
export class NullEventPublisher implements ReckonEventPublisher {
  publish(_event: ReckonEvent): void {
    /* intentional no-op */
  }
}

/** A publisher fanning events out to a list of subscribers (append-only wiring). */
export class FanoutEventPublisher implements ReckonEventPublisher {
  readonly #subscribers: readonly ReckonEventPublisher[];

  constructor(subscribers: readonly ReckonEventPublisher[] = []) {
    this.#subscribers = subscribers;
  }

  publish(event: ReckonEvent): Promise<void> {
    return Promise.all(
      this.#subscribers.map(async (subscriber) => {
        await subscriber.publish(event);
      }),
    ).then(() => undefined);
  }
}

/* ------------------------------------------------------------------ *
 * Event construction (validated)                                        *
 * ------------------------------------------------------------------ */

/** Caller-supplied identity for one emitted event (determinism law). */
export interface EmissionIds {
  /** The new event id (evt_… — see generateWebhookEventId in @reckon/contracts). */
  readonly id: string;
  /** Emission time (epoch ms — the composition clock, never invented here). */
  readonly created: number;
}

/** Validate + freeze one constructed event against the frozen envelope. */
function validated(event: ReckonEvent): ReckonEvent {
  const parsed = ReckonEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new EventValidationError(
      `emitted ${event.type} event failed ReckonEventSchema validation`,
      toValidationIssues(parsed.error),
      event,
    );
  }
  return parsed.data;
}

/**
 * Construct a typed thin event. `data` is the catalog payload for
 * `type` (thin: ids + timestamps + scalars). Throws the typed
 * EventValidationError when the result violates the frozen envelope.
 */
export function createReckonEvent(input: {
  readonly id: string;
  readonly type: WebhookEventType;
  readonly tenant: TenantScope;
  readonly created: number;
  readonly data: unknown;
}): ReckonEvent {
  return validated({
    id: input.id,
    object: "event",
    type: input.type,
    created: input.created,
    tenant: input.tenant,
    data: { object: input.data },
  } as ReckonEvent);
}

/* ------------------------------------------------------------------ *
 * Domain mappers (decision / outcome / preference / drift / lifecycle)  *
 * ------------------------------------------------------------------ */

/**
 * `schedule.executed` from a decision's schedule delta.
 *
 * Returns null when: the decision carries no schedule delta, or the
 * delta's plan anchor cannot be resolved (delta.planId ?? requestPlanId
 * both absent) — the documented payload REQUIRES planId and it is never
 * invented.
 */
export function scheduleExecutedEvent(
  decision: DecisionResult,
  ids: EmissionIds,
  requestPlanId?: string,
): ReckonEvent | null {
  const delta = decision.scheduleDelta;
  if (delta === undefined) return null;
  const planId = delta.planId ?? requestPlanId;
  if (planId === undefined || planId === "") return null;
  return createReckonEvent({
    id: ids.id,
    type: "schedule.executed",
    tenant: decision.tenant,
    created: ids.created,
    data: {
      planId,
      decisionId: decision.decisionId,
      action: delta.action,
      enqueued: [...delta.enqueue],
      dequeued: [...delta.dequeue],
      executedAt: decision.at,
    },
  });
}

/**
 * `recommendation.delivered` from a host delivery confirmation (the
 * outcome event of eventType "impression") plus the decision it
 * confirms.
 *
 * Returns null when: the outcome did not confirm a SUGGEST/SWITCH
 * decision, or the experience/item anchors cannot be resolved from the
 * two records (documented payload requires all of decisionId,
 * requestId, experienceId, itemId).
 */
export function recommendationDeliveredEvent(
  outcome: OutcomeEvent,
  decision: DecisionResult,
  ids: EmissionIds,
): ReckonEvent | null {
  if (decision.action !== "SUGGEST" && decision.action !== "SWITCH") return null;
  const decisionId = outcome.decisionId ?? decision.decisionId;
  const experienceId = outcome.experienceId ?? decision.selectedExperience?.experienceId;
  const itemId = decision.selectedExperience?.itemId;
  if (decisionId === undefined || experienceId === undefined || itemId === undefined) return null;
  return createReckonEvent({
    id: ids.id,
    type: "recommendation.delivered",
    tenant: decision.tenant,
    created: ids.created,
    data: {
      decisionId,
      requestId: decision.requestId,
      experienceId,
      itemId,
      action: decision.action,
      deliveredAt: outcome.occurredAt,
    },
  });
}

/**
 * `preference.updated` from an appended preference delta (the loop
 * closing in real time — fires for every successfully ingested delta).
 */
export function preferenceUpdatedEvent(delta: PreferenceDelta, ids: EmissionIds): ReckonEvent {
  return createReckonEvent({
    id: ids.id,
    type: "preference.updated",
    tenant: delta.tenant,
    created: ids.created,
    data: {
      deltaId: delta.deltaId,
      subject: delta.subject,
      dimension: delta.dimension,
      op: delta.op,
      ...(delta.resultingConfidence !== undefined
        ? { resultingConfidence: delta.resultingConfidence }
        : {}),
      modelId: delta.model.modelId,
      modelVersion: delta.model.version,
    },
  });
}

/** `model.drift.detected` payload (the research runtime's drift monitor). */
export interface ModelDriftInput {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly driftScore: number;
  readonly threshold: number;
  readonly window: string;
  readonly metric: string;
  readonly evaluatedAt: number;
}

/** `model.drift.detected` from the research runtime's drift monitor. */
export function modelDriftDetectedEvent(
  drift: ModelDriftInput,
  tenant: TenantScope,
  ids: EmissionIds,
): ReckonEvent {
  return createReckonEvent({
    id: ids.id,
    type: "model.drift.detected",
    tenant,
    created: ids.created,
    data: { ...drift },
  });
}

/** `webhook.endpoint.created` (delivery-lifecycle). */
export function webhookEndpointCreatedEvent(
  endpoint: { readonly endpointId: string; readonly url: string; readonly eventTypes: readonly string[] },
  tenant: TenantScope,
  ids: EmissionIds,
): ReckonEvent {
  return createReckonEvent({
    id: ids.id,
    type: "webhook.endpoint.created",
    tenant,
    created: ids.created,
    data: {
      endpointId: endpoint.endpointId,
      url: endpoint.url,
      eventTypes: [...endpoint.eventTypes],
    },
  });
}

/** `webhook.endpoint.deleted` (delivery-lifecycle). */
export function webhookEndpointDeletedEvent(
  endpoint: { readonly endpointId: string; readonly url: string },
  tenant: TenantScope,
  ids: EmissionIds,
): ReckonEvent {
  return createReckonEvent({
    id: ids.id,
    type: "webhook.endpoint.deleted",
    tenant,
    created: ids.created,
    data: {
      endpointId: endpoint.endpointId,
      url: endpoint.url,
    },
  });
}
