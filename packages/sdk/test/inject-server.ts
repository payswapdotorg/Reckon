/**
 * Real-app server builder for error-path SDK tests: wires ONLY the handler
 * ports a test wants to override (everything else stays at the honest
 * NotWired 501 defaults) and adapts it to the SDK fetch seam.
 */
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../apps/api/src/index.js";
import type { PartialHandlerPorts } from "../../../apps/api/src/ports.js";
import { createInjectFetch } from "../src/testing.js";
import type { FetchLike } from "../src/client.js";
import { SDK_KEYS } from "./harness.js";

export interface InjectServer {
  readonly app: FastifyInstance;
  readonly fetch: FetchLike;
}

export function buildInjectServer(handlers: PartialHandlerPorts = {}): InjectServer {
  const app = buildServer({ apiVersion: "test", keys: [...SDK_KEYS], handlers });
  return { app, fetch: createInjectFetch(app) };
}
