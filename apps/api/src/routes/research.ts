import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import { IdSchema } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import { authPreHandler, requireAuth, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * Research job surface (UI-008): the durable FIFO queue per ADR-004
 * (enqueue → lease → done/failed). Bodies are composed from frozen
 * primitives only (id + kind strings, opaque payload) — there is no
 * frozen experiment contract; the payload stays opaque to the API.
 */
// Field types compose from the frozen IdSchema primitive; the state enum
// is an API-level envelope over the persistence states (no frozen contract
// exists for research jobs — the payload stays opaque).
const EnqueueResearchJobSchema = z.object({
  jobId: IdSchema,
  kind: IdSchema,
  payload: z.unknown().optional(),
});

const ResearchJobResponseSchema = z.object({
  jobId: IdSchema,
  kind: IdSchema,
  state: z.enum(["queued", "leased", "done", "failed"]),
  payload: z.unknown(),
  resultRef: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const STATES = new Set(["queued", "leased", "done", "failed"]);

export function registerResearchRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/research/jobs",
    { preHandler: [authPreHandler(deps, "research")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: "reckon.api.research-job",
        requestSchema: EnqueueResearchJobSchema,
        responseSchema: ResearchJobResponseSchema,
        tenantFromBody: () => ({ tenantId: requireAuth(request).tenantId }),
        responseTenantOf: () => ({ tenantId: requireAuth(request).tenantId }),
        execute: (job, auth) => deps.handlers.researchHandler.enqueue(job, auth),
      });
    },
  );

  app.get<{ Params: { jobId: string } }>(
    "/v1/research/jobs/:jobId",
    { preHandler: [authPreHandler(deps, "research")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const found = await deps.handlers.researchHandler.get(request.params.jobId, auth);
      if (found === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Research job not found: ${request.params.jobId}`, {
          jobId: request.params.jobId,
        });
      }
      reply.code(200).send(found);
    },
  );

  app.get<{ Querystring: { limit?: string; state?: string } }>(
    "/v1/research/jobs",
    { preHandler: [authPreHandler(deps, "research")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const rawLimit = request.query.limit;
      let limit = 20;
      if (rawLimit !== undefined && rawLimit !== "") {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_ERROR,
            400,
            `limit must be an integer 1..100, got '${rawLimit}'`,
            { limit: rawLimit },
          );
        }
        limit = parsed;
      }
      const state = request.query.state;
      if (state !== undefined && state !== "" && !STATES.has(state)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_ERROR,
          400,
          `state must be one of queued|leased|done|failed, got '${state}'`,
          { state },
        );
      }
      const jobs = await deps.handlers.researchHandler.list(
        auth,
        limit,
        state === "" || state === undefined ? undefined : (state as "queued" | "leased" | "done" | "failed"),
      );
      reply.code(200).send({ jobs });
    },
  );
}
