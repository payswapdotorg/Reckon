import type { FastifyInstance } from "fastify";
import { CONTRACT_IDS, CatalogItemSchema, RealizationSchema } from "@reckon/contracts";
import { authPreHandler, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * Catalog ingestion. The frozen CatalogItem/Realization contracts carry no
 * tenant field: the authenticated tenant (from the API key) is the
 * authoritative scope; the advisory X-Reckon-Tenant header, if present,
 * must match (checked in the auth preHandler).
 */
export function registerCatalogRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/catalog/items",
    { preHandler: [authPreHandler(deps, "catalog")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.catalogItem,
        requestSchema: CatalogItemSchema,
        responseSchema: CatalogItemSchema,
        execute: (item, auth) => deps.handlers.catalogItemIngest.ingest(item, auth),
      });
    },
  );

  app.post(
    "/v1/catalog/realizations",
    { preHandler: [authPreHandler(deps, "catalog")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.realization,
        requestSchema: RealizationSchema,
        responseSchema: RealizationSchema,
        execute: (realization, auth) => deps.handlers.realizationIngest.ingest(realization, auth),
      });
    },
  );
}
