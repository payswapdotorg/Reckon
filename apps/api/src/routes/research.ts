import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import { IdSchema } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import { authPreHandler, requireAuth, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";
import { fetchSizeFor, paginationMeta, parsePaginationParams, slicePage } from "../pagination.js";

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

  // S2-001: cursor pagination (limit 1..100 default 20, starting_after,
  // has_more + next_cursor; ordering newest-first — stable). The state
  // filter stays composable with pagination (the cursor slices the
  // filtered list).
  app.get(
    "/v1/research/jobs",
    { preHandler: [authPreHandler(deps, "research")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = request.query as Record<string, unknown>;
      const params = parsePaginationParams(query);
      const state = firstQueryValue(query["state"]);
      if (state !== undefined && !STATES.has(state)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_ERROR,
          400,
          `state must be one of queued|leased|done|failed, got '${state}'`,
          { state },
          "state",
        );
      }
      const jobs = await deps.handlers.researchHandler.list(
        auth,
        fetchSizeFor(params),
        state as "queued" | "leased" | "done" | "failed" | undefined,
      );
      const page = slicePage(jobs, params, (job) => job.jobId);
      reply.code(200).send({ jobs: page.items, ...paginationMeta(page) });
    },
  );
}

function firstQueryValue(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return undefined;
  return typeof value === "string" ? value : String(value);
}
