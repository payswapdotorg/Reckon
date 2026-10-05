import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import {
  IdSchema,
  ReckonEventSchema,
  WebhookDeliveryViewSchema,
  WebhookEndpointCreatedSchema,
  WebhookEndpointCreateSchema,
  WebhookEndpointViewSchema,
  WebhookReplayResponseSchema,
} from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import { authPreHandler, requireAuth, runContractRoute, validateHandlerResponse } from "./shared.js";
import type { RouteDeps } from "./shared.js";
import { fetchSizeFor, paginationMeta, parsePaginationParams, slicePage } from "../pagination.js";
import { assertResponseTenant } from "../tenant.js";
import type { WebhookDeliveryFilter } from "../webhooks/ports.js";

/**
 * S2-002 — the /v1/webhooks route family (scope: "webhooks").
 *
 *   POST   /v1/webhooks/endpoints                 register (secret issued ONCE)
 *   GET    /v1/webhooks/endpoints                 list (cursor-paginated, newest first)
 *   GET    /v1/webhooks/endpoints/:endpointId     retrieve
 *   DELETE /v1/webhooks/endpoints/:endpointId     delete
 *   GET    /v1/webhooks/events/:eventId           retrieve a stored event (30-day retention)
 *   POST   /v1/webhooks/events/:eventId/replay    re-deliver (same event id; Idempotency-Key)
 *   GET    /v1/webhooks/deliveries                delivery log (cursor-paginated + filters)
 *
 * Every route rides the S2-001 pipeline: bearer auth → rate limit →
 * version negotiation → webhooks scope → tenant checks → (POST)
 * Idempotency-Key validation/replay → typed error envelopes.
 */

/**
 * The replay request body: an EMPTY JSON object (or no body at all).
 * Composed exactly like the envelopes.ts API-level schemas — an empty
 * object has no hand-written field types; the default covers the
 * bodyless form so the idempotency digest stays deterministic.
 */
const WebhookReplayBodySchema = z.object({}).default({});

function firstValue(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

/** Parse the optional delivery-log filters (endpoint_id / event_id) → typed 400s. */
function parseDeliveryFilter(query: Record<string, unknown>): WebhookDeliveryFilter | undefined {
  const endpointId = firstValue(query["endpoint_id"]);
  const eventId = firstValue(query["event_id"]);
  if (endpointId === undefined && eventId === undefined) return undefined;
  const filter: { endpointId?: string; eventId?: string } = {};
  if (endpointId !== undefined && endpointId !== "") {
    if (!IdSchema.safeParse(endpointId).success) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `endpoint_id filter must be a well-formed object id, got '${endpointId}'`,
        { endpoint_id: endpointId },
        "endpoint_id",
      );
    }
    filter.endpointId = endpointId;
  }
  if (eventId !== undefined && eventId !== "") {
    if (!IdSchema.safeParse(eventId).success) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        `event_id filter must be a well-formed object id, got '${eventId}'`,
        { event_id: eventId },
        "event_id",
      );
    }
    filter.eventId = eventId;
  }
  return filter;
}

export function registerWebhookRoutes(app: FastifyInstance, deps: RouteDeps): void {
  /* ---------------- endpoints: create ---------------- */

  app.post(
    "/v1/webhooks/endpoints",
    { preHandler: [authPreHandler(deps, "webhooks")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: "reckon.api.webhook-endpoint-create",
        responseContractId: "reckon.api.webhook-endpoint",
        requestSchema: WebhookEndpointCreateSchema,
        responseSchema: WebhookEndpointCreatedSchema,
        // Tenant comes from the key (TENANT LAW); the frozen response
        // contract carries it and is asserted against the auth context.
        responseTenantOf: (endpoint) => endpoint.tenant,
        execute: (body, auth) =>
          deps.handlers.webhookHandler.createEndpoint(
            {
              url: body.url,
              ...(body.description !== undefined ? { description: body.description } : {}),
              eventTypes: body.eventTypes,
            },
            auth,
          ),
      });
    },
  );

  /* ---------------- endpoints: list (cursor-paginated) ---------------- */

  app.get(
    "/v1/webhooks/endpoints",
    { preHandler: [authPreHandler(deps, "webhooks")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = parsePaginationParams(request.query as Record<string, unknown>);
      const recent = await deps.handlers.webhookHandler.listEndpoints(auth, fetchSizeFor(params));
      const validated = recent.map((endpoint) =>
        validateHandlerResponse(WebhookEndpointViewSchema, endpoint, "reckon.api.webhook-endpoint"),
      );
      // The view schema validation strips any secret field defensively.
      for (const endpoint of validated) assertResponseTenant(auth, endpoint.tenant);
      const page = slicePage(validated, params, (endpoint) => endpoint.id);
      reply.code(200).send({ endpoints: page.items, ...paginationMeta(page) });
    },
  );

  /* ---------------- endpoints: retrieve ---------------- */

  app.get<{ Params: { endpointId: string } }>(
    "/v1/webhooks/endpoints/:endpointId",
    { preHandler: [authPreHandler(deps, "webhooks")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const endpointId = request.params.endpointId;
      const found = await deps.handlers.webhookHandler.getEndpoint(endpointId, auth);
      if (found === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Webhook endpoint not found: ${endpointId}`, {
          endpointId,
        });
      }
      const parsed = validateHandlerResponse(WebhookEndpointViewSchema, found, "reckon.api.webhook-endpoint");
      assertResponseTenant(auth, parsed.tenant);
      reply.code(200).send(parsed);
    },
  );

  /* ---------------- endpoints: delete ---------------- */

  app.delete<{ Params: { endpointId: string } }>(
    "/v1/webhooks/endpoints/:endpointId",
    { preHandler: [authPreHandler(deps, "webhooks")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const endpointId = request.params.endpointId;
      const removed = await deps.handlers.webhookHandler.deleteEndpoint(endpointId, auth);
      if (removed === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Webhook endpoint not found: ${endpointId}`, {
          endpointId,
        });
      }
      const parsed = validateHandlerResponse(WebhookEndpointViewSchema, removed, "reckon.api.webhook-endpoint");
      assertResponseTenant(auth, parsed.tenant);
      reply.code(200).send(parsed);
    },
  );

  /* ---------------- events: retrieve ---------------- */

  app.get<{ Params: { eventId: string } }>(
    "/v1/webhooks/events/:eventId",
    { preHandler: [authPreHandler(deps, "webhooks")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const eventId = request.params.eventId;
      const event = await deps.handlers.webhookHandler.getEvent(eventId, auth);
      if (event === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Webhook event not found: ${eventId}`, {
          eventId,
        });
      }
      const parsed = validateHandlerResponse(ReckonEventSchema, event, "reckon.api.webhook-event");
      assertResponseTenant(auth, parsed.tenant);
      reply.code(200).send(parsed);
    },
  );

  /* ---------------- events: replay ---------------- */

  app.post<{ Params: { eventId: string } }>(
    "/v1/webhooks/events/:eventId/replay",
    { preHandler: [authPreHandler(deps, "webhooks")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: "reckon.api.webhook-event-replay",
        responseContractId: "reckon.api.webhook-event-replay",
        requestSchema: WebhookReplayBodySchema,
        responseSchema: WebhookReplayResponseSchema,
        responseTenantOf: (response) => response.event.tenant,
        execute: async (_body, auth) => {
          const replayed = await deps.handlers.webhookHandler.replayEvent(request.params.eventId, auth);
          if (replayed === null) {
            throw new ApiError(
              ERROR_CODES.NOT_FOUND,
              404,
              `Webhook event not found: ${request.params.eventId}`,
              { eventId: request.params.eventId },
            );
          }
          return replayed;
        },
      });
    },
  );

  /* ---------------- delivery log (cursor-paginated + filters) ---------------- */

  app.get(
    "/v1/webhooks/deliveries",
    { preHandler: [authPreHandler(deps, "webhooks")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = parsePaginationParams(request.query as Record<string, unknown>);
      const filter = parseDeliveryFilter(request.query as Record<string, unknown>);
      const recent = await deps.handlers.webhookHandler.listDeliveries(auth, fetchSizeFor(params), filter);
      const validated = recent.map((delivery) =>
        validateHandlerResponse(WebhookDeliveryViewSchema, delivery, "reckon.api.webhook-delivery"),
      );
      for (const delivery of validated) assertResponseTenant(auth, delivery.tenant);
      const page = slicePage(validated, params, (delivery) => delivery.id);
      reply.code(200).send({ deliveries: page.items, ...paginationMeta(page) });
    },
  );
}
