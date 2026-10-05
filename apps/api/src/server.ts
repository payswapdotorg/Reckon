import { fastify } from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiVersionSchema } from "@reckon/contracts";
import { ObservabilityRecorder } from "@reckon/observability";
import { KeyStore } from "./auth.js";
import { DEFAULT_API_VERSION } from "./config.js";
import type { ApiConfig } from "./config.js";
import { ApiError, ERROR_CODES, errorEnvelope, setDocsBaseUrl } from "./errors.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import { observedDecisionHandler, observedOutcomeIngest, recordRouteErrorSafely } from "./observability.js";
import { notWiredDefaults } from "./ports.js";
import type { HandlerPorts, PartialHandlerPorts } from "./ports.js";
import { createRateLimiter } from "./rate-limit.js";
import { DEFAULT_API_VERSION_REGISTRY, assertRegistryCoherent, withRegisteredDefault } from "./versioning.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerCandidateRoutes } from "./routes/candidates.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerExperienceRoutes } from "./routes/experiences.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerOutcomeRoutes } from "./routes/outcomes.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerPreferenceRoutes } from "./routes/preferences.js";
import { registerResearchRoutes } from "./routes/research.js";
import type { RouteDeps } from "./routes/shared.js";

/**
 * Composition root: buildServer(config) → FastifyInstance. Everything is
 * injectable (handler ports, key store, idempotency map); missing ports
 * get deterministic NotWired (501) defaults. No global mutable singletons.
 */
export function buildServer(config: ApiConfig): FastifyInstance {
  const keyStore = config.keyStore ?? new KeyStore(config.keys ?? []);
  const clock = config.clock ?? (() => Date.now());
  const idempotency = config.idempotencyStore ?? new InMemoryIdempotencyStore({ clock });
  const portStatus = new Map<string, "wired" | "not-wired">();
  const handlers = resolveHandlers(config.handlers, portStatus);

  // S2-001 — developer-platform hardening composition:
  //   version registry + pinned default (asserted coherent at boot),
  //   per-key rate limiter (opt-in), docs URL base for error doc_url,
  //   shared clock for the idempotency window.
  //
  // `config.apiVersion` stays the free-form BUILD LABEL (health
  // reporting — pre-S2-001 semantics preserved). Version NEGOTIATION has
  // its own pin: `config.defaultApiVersion`, falling back to the label
  // when it is a valid version string (one env var pins both), else the
  // shipped default.
  const buildLabel = config.apiVersion ?? DEFAULT_API_VERSION;
  const negotiationDefault =
    config.defaultApiVersion ??
    (ApiVersionSchema.safeParse(buildLabel).success ? buildLabel : DEFAULT_API_VERSION);
  const versionRegistry =
    config.apiVersions ?? withRegisteredDefault(DEFAULT_API_VERSION_REGISTRY, negotiationDefault);
  assertRegistryCoherent(versionRegistry, negotiationDefault);
  setDocsBaseUrl(config.docsBaseUrl);
  const rateLimiter = config.rateLimit !== undefined ? createRateLimiter(config.rateLimit, clock) : undefined;

  // W3-004 observability composition: wrap the WIRED decision/outcome
  // handler ports with record-emitting wrappers (route contracts frozen),
  // and emit an integration-capability record per handler port (wired =
  // available). Latency comes from the injected clock.
  const observability = config.observability;
  const obsClock = observability?.clock ?? clock;
  const recorder =
    observability !== undefined
      ? new ObservabilityRecorder({
          sink: observability.sink,
          clock: obsClock,
          ...(observability.idGenerator !== undefined ? { idGenerator: observability.idGenerator } : {}),
          ...(observability.evidenceClass !== undefined ? { evidenceClass: observability.evidenceClass } : {}),
        })
      : undefined;
  if (recorder !== undefined) {
    if (portStatus.get("decisionHandler") === "wired") {
      handlers.decisionHandler = observedDecisionHandler(handlers.decisionHandler, { recorder, clock: obsClock });
    }
    if (portStatus.get("outcomeIngest") === "wired") {
      handlers.outcomeIngest = observedOutcomeIngest(handlers.outcomeIngest, { recorder });
    }
    for (const [port, status] of portStatus.entries()) {
      recorder.recordIntegrationCapability({
        integration: "@reckon/api",
        capability: `handler:${port}`,
        available: status === "wired",
        ...(status === "wired" ? {} : { detail: "NotWired" }),
      });
    }
  }

  const deps: RouteDeps = {
    keyStore,
    idempotency,
    handlers,
    apiVersion: buildLabel,
    versionRegistry,
    defaultApiVersion: negotiationDefault,
    ...(rateLimiter !== undefined ? { rateLimiter } : {}),
    clock,
  };

  const app: FastifyInstance = fastify({ logger: config.logger ?? false });

  app.setErrorHandler((error: Error & { statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
    // W3-004: error-path records (scope "route"), safely — telemetry
    // must never mask the real API error envelope.
    if (recorder !== undefined) {
      const statusCode =
        error instanceof ApiError
          ? error.statusCode
          : typeof error.statusCode === "number"
            ? error.statusCode
            : 500;
      if (statusCode >= 400) {
        const code =
          error instanceof ApiError
            ? error.code
            : statusCode === 404
              ? ERROR_CODES.NOT_FOUND
              : ERROR_CODES.INTERNAL;
        const path = request.url.split("?")[0] ?? request.url;
        recordRouteErrorSafely(recorder, {
          code,
          message: error.message,
          route: `${request.method} ${path}`,
          ...(request.reckonAuth !== undefined
            ? {
                tenant: {
                  tenantId: request.reckonAuth.tenantId,
                  ...(request.reckonAuth.workspaceId !== undefined
                    ? { workspaceId: request.reckonAuth.workspaceId }
                    : {}),
                },
              }
            : {}),
        });
      }
    }
    if (error instanceof ApiError) {
      if (error.retryAfterSeconds !== undefined) {
        reply.header("retry-after", String(error.retryAfterSeconds));
      }
      reply
        .code(error.statusCode)
        .send(errorEnvelope(error.code, error.message, error.details, error.param));
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
  registerAgentRoutes(app, deps);
  registerResearchRoutes(app, deps);
  registerIntegrationRoutes(app, deps);

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
