import type { FastifyInstance } from "fastify";
import { CONTRACTS_VERSION } from "@reckon/contracts";
import type { RouteDeps } from "./shared.js";

export interface PortStatusMap {
  readonly entries: ReadonlyMap<string, "wired" | "not-wired">;
}

/** Liveness + readiness probes. No auth — deliberately open. */
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
