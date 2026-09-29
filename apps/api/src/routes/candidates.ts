import type { FastifyInstance } from "fastify";
import { CONTRACTS_VERSION, CandidateSetSchema } from "@reckon/contracts";
import { authPreHandler, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * Candidate set submission — the decision-input surface, gated by the
 * `decisions` scope (CandidateSet is the retrieval input embedded in
 * DecisionRequest per public-contract-map.md).
 *
 * The frozen CandidateSet contract has no `schema`/`schemaVersion` fields
 * (it is embedded in decision-request.schema.json and has no standalone
 * CONTRACT_IDS registry entry). The API therefore injects a schema echo on
 * the response envelope:
 *   schema: "reckon.candidate-set", schemaVersion: CONTRACTS_VERSION
 * "reckon.candidate-set" is an API-level label, not a registered contract
 * id — flagged for TL3 in the work report.
 */
const CANDIDATE_SET_SCHEMA_LABEL = "reckon.candidate-set";

export function registerCandidateRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/candidates",
    { preHandler: [authPreHandler(deps, "decisions")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CANDIDATE_SET_SCHEMA_LABEL,
        requestSchema: CandidateSetSchema,
        responseSchema: CandidateSetSchema,
        transformResponse: (set) => ({
          schema: CANDIDATE_SET_SCHEMA_LABEL,
          schemaVersion: CONTRACTS_VERSION,
          ...set,
        }),
        execute: (set, auth) => deps.handlers.candidatesHandler.submit(set, auth),
      });
    },
  );
}
