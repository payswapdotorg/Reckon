import type { FastifyInstance } from "fastify";
import { CONTRACTS_VERSION } from "@reckon/contracts";
import type { RouteDeps } from "./shared.js";

export interface PortStatusMap {
  readonly entries: ReadonlyMap<string, "wired" | "not-wired">;
}

/**
 * Liveness + readiness probes. No auth — deliberately open.
 *
 * TL6-002: the readyz handlers map advertises `webhookHandler` as a
 * WIRED port whenever the production composition mounts config.webhooks
 * (buildServer sets the entry to "wired" when the PG-backed webhook
 * system is composed; the no-DATABASE_URL fallback path keeps it
 * honestly "not-wired" — never claims an unwired port). The honest
 * count of wired ports grows by exactly one in the production path.
 */
export function registerHealthRoutes(app: FastifyInstance, deps: RouteDeps, portStatus: PortStatusMap): void {
  app.get("/healthz", async (_request, reply) => {
    reply.code(200).send({ ok: true, version: deps.apiVersion, contractsVersion: CONTRACTS_VERSION });
  });

  app.get("/readyz", async (_request, reply) => {
    const handlers: Record<string, string> = {};
    for (const [port, status] of portStatus.entries) handlers[port] = status;
    reply.code(200).send({
      ok: true,
      version: deps.apiVersion,
      contractsVersion: CONTRACTS_VERSION,
      handlers,
    });
  });
}
