import { fastify } from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KeyStore } from "./auth.js";
import { DEFAULT_API_VERSION } from "./config.js";
import type { ApiConfig } from "./config.js";
import { ApiError, ERROR_CODES, errorEnvelope } from "./errors.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import { notWiredDefaults } from "./ports.js";
import type { HandlerPorts, PartialHandlerPorts } from "./ports.js";
import { registerCandidateRoutes } from "./routes/candidates.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerExperienceRoutes } from "./routes/experiences.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerOutcomeRoutes } from "./routes/outcomes.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerPreferenceRoutes } from "./routes/preferences.js";
import type { RouteDeps } from "./routes/shared.js";

/**
 * Composition root: buildServer(config) → FastifyInstance. Everything is
 * injectable (handler ports, key store, idempotency map); missing ports
 * get deterministic NotWired (501) defaults. No global mutable singletons.
 */
export function buildServer(config: ApiConfig): FastifyInstance {
  const keyStore = config.keyStore ?? new KeyStore(config.keys ?? []);
  const idempotency = config.idempotencyStore ?? new InMemoryIdempotencyStore();
  const portStatus = new Map<string, "wired" | "not-wired">();
  const handlers = resolveHandlers(config.handlers, portStatus);
  const deps: RouteDeps = {
    keyStore,
    idempotency,
    handlers,
    apiVersion: config.apiVersion ?? DEFAULT_API_VERSION,
  };

  const app: FastifyInstance = fastify({ logger: config.logger ?? false });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send(errorEnvelope(error.code, error.message, error.details));
      return;
    }
    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    // Fastify body parsing / content-type failures (400/415) are request
    // body problems → typed VALIDATION_ERROR envelope.
    if (statusCode === 400 || statusCode === 415) {
      reply
        .code(400)
        .send(
          errorEnvelope(
            ERROR_CODES.VALIDATION_ERROR,
            "Request body could not be parsed as JSON (Content-Type must be application/json)",
          ),
        );
      return;
    }
    if (statusCode === 404) {
      reply.code(404).send(errorEnvelope(ERROR_CODES.NOT_FOUND, error.message || "Not found"));
      return;
    }
    reply.code(500).send(errorEnvelope(ERROR_CODES.INTERNAL, error.message || "Internal server error"));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply
      .code(404)
      .send(errorEnvelope(ERROR_CODES.NOT_FOUND, `Route not found: ${request.method} ${request.url}`));
  });

  registerHealthRoutes(app, deps, { entries: portStatus });
  registerDecisionRoutes(app, deps);
  registerOutcomeRoutes(app, deps);
  registerPreferenceRoutes(app, deps);
  registerPlanRoutes(app, deps);
  registerCatalogRoutes(app, deps);
  registerCandidateRoutes(app, deps);
  registerExperienceRoutes(app, deps);

  return app;
}

function resolveHandlers(
  provided: PartialHandlerPorts | undefined,
  portStatus: Map<string, "wired" | "not-wired">,
): HandlerPorts {
  const merged: HandlerPorts = notWiredDefaults();
  const entries = Object.entries(provided ?? {}) as [keyof HandlerPorts, unknown][];
  for (const [port, implementation] of entries) {
    if (implementation !== undefined) {
      (merged as unknown as Record<string, unknown>)[port] = implementation;
      portStatus.set(String(port), "wired");
    }
  }
  for (const port of Object.keys(merged) as (keyof HandlerPorts)[]) {
    if (!portStatus.has(String(port))) portStatus.set(String(port), "not-wired");
  }
  return merged;
}
