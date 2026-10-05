import type { DecisionStore, DecisionHandler, OutcomeIngestHandler, PreferenceIngestHandler } from "../ports.js";
import type { AuthContext } from "../types.js";
import {
  preferenceUpdatedEvent,
  recommendationDeliveredEvent,
  scheduleExecutedEvent,
} from "@reckon/events";
import type { ReckonEvent } from "@reckon/contracts";
import type { WebhookSystem } from "./ports.js";

/**
 * S2-002 — the emission wrappers wired into the domain paths (the
 * same decorator pattern as the W3-004 observability wrappers):
 *
 *   POST /v1/decisions      (wired decisionHandler)  → schedule.executed
 *   POST /v1/outcomes       (wired outcomeIngest)    → recommendation.delivered
 *   POST /v1/preferences    (wired preferenceIngest) → preference.updated
 *
 * The wrappers publish through the WebhookSystem's ReckonEventPublisher
 * surface. `publish` is TOTAL by port law (delivery failures land in
 * the delivery log) — a webhook outage can never break a domain route.
 * Mappers returning null (unresolvable payload anchors) skip emission:
 * a thin event never carries invented fields.
 *
 * Drift (model.drift.detected) is emitted by the research runtime
 * through the same publisher (modelDriftDetectedEvent in
 * @reckon/events) — the research composition is that lane's owner.
 */

/** Wrap a wired decision handler: emit schedule.executed on non-empty schedule deltas. */
export function webhookEmittingDecisionHandler(
  inner: DecisionHandler,
  webhooks: WebhookSystem,
): DecisionHandler {
  return {
    decide: async (request, auth) => {
      const result = await inner.decide(request, auth);
      const event = scheduleExecutedEvent(result, { id: webhooks.newEventId(), created: webhooks.clock() }, request.planId);
      if (event !== null) await webhooks.publish(event);
      return result;
    },
  };
}

/**
 * Wrap a wired outcome ingest handler: emit recommendation.delivered
 * when the host confirms delivery — an `impression` outcome referencing
 * a decision. The decisionStore port resolves the requestId/action/item
 * anchors; when it is not mounted the wrapper skips emission (it never
 * invents them).
 */
export function webhookEmittingOutcomeIngest(
  inner: OutcomeIngestHandler,
  webhooks: WebhookSystem,
  decisionStore: DecisionStore | undefined,
): OutcomeIngestHandler {
  return {
    ingest: async (event, auth) => {
      const ingested = await inner.ingest(event, auth);
      if (event.eventType !== "impression" || event.decisionId === undefined) return ingested;
      if (decisionStore === undefined) return ingested;
      try {
        const decision = await decisionStore.get(auth.tenantId, event.decisionId);
        if (decision === null) return ingested;
        const webhookEvent: ReckonEvent | null = recommendationDeliveredEvent(
          ingested,
          decision,
          { id: webhooks.newEventId(), created: webhooks.clock() },
        );
        if (webhookEvent !== null) await webhooks.publish(webhookEvent);
      } catch {
        // The decision lookup is an emission ENRICHMENT, never a route
        // dependency: lookup failures skip emission (logged in the
        // domain path's own error surface, not here).
      }
      return ingested;
    },
  };
}

/** Wrap a wired preference ingest handler: emit preference.updated for every appended delta. */
export function webhookEmittingPreferenceIngest(
  inner: PreferenceIngestHandler,
  webhooks: WebhookSystem,
): PreferenceIngestHandler {
  return {
    ingest: async (delta, auth) => {
      const ingested = await inner.ingest(delta, auth);
      const event = preferenceUpdatedEvent(ingested, {
        id: webhooks.newEventId(),
        created: webhooks.clock(),
      });
      await webhooks.publish(event);
      return ingested;
    },
  };
}
