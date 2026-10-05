import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { StaticKeyConfig } from "../src/auth.js";
import type { PartialHandlerPorts } from "../src/ports.js";
import type { WebhookRetryOptions } from "@reckon/contracts";
import { generatePublishableKey } from "@reckon/contracts";
import {
  createInMemoryWebhookSystem,
  ManualWebhookClock,
  type InMemoryWebhookSystem,
} from "../src/webhooks/in-memory.js";
import type { WebhookHttpClient, WebhookHttpResponse } from "../src/webhooks/ports.js";

/**
 * S2-002 webhook test helpers: a RECORDING outbound client (tests
 * script per-call outcomes), a ManualWebhookClock and a server builder
 * that mounts the in-memory webhook system through buildServer
 * (config.webhooks — the real composition path, never a shortcut).
 */

export interface RecordedWebhookCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly rawBody: string;
}

/**
 * Recording/scripted outbound client. `respond` decides each POST's
 * outcome (default: 200 in 1ms); THROWING from `respond` simulates a
 * transport failure (network error path). Every call is recorded with
 * the exact bytes + headers the engine signed.
 */
export class RecordingWebhookClient implements WebhookHttpClient {
  readonly calls: RecordedWebhookCall[] = [];
  readonly #respond: (call: RecordedWebhookCall, index: number) => WebhookHttpResponse;

  constructor(
    respond: (call: RecordedWebhookCall, index: number) => WebhookHttpResponse = () => ({
      statusCode: 200,
      latencyMs: 1,
    }),
  ) {
    this.#respond = respond;
  }

  async post(url: string, headers: Record<string, string>, rawBody: string): Promise<WebhookHttpResponse> {
    const call = { url, headers, rawBody };
    this.calls.push(call);
    return this.#respond(call, this.calls.length - 1);
  }

  get count(): number {
    return this.calls.length;
  }

  /** The last recorded delivery (asserts signature/payload on the freshest POST). */
  last(): RecordedWebhookCall | undefined {
    return this.calls[this.calls.length - 1];
  }
}

const PK_LIVE = generatePublishableKey("live");

/** Key matrix for the webhook route tests. */
export const WEBHOOK_TEST_KEYS: StaticKeyConfig[] = [
  { apiKey: "wh-full", tenantId: "tenant-a", scopes: ["webhooks", "decisions", "outcomes", "plans"] },
  { apiKey: "wh-only", tenantId: "tenant-b", scopes: ["webhooks"] },
  { apiKey: "wh-none", tenantId: "tenant-a", scopes: ["decisions"] },
  { apiKey: "wh-ws", tenantId: "tenant-a", workspaceId: "ws-1", scopes: ["webhooks"] },
  { apiKey: PK_LIVE, tenantId: "tenant-a", scopes: ["webhooks", "decisions"] },
];

export interface WebhookTestServer {
  readonly app: FastifyInstance;
  readonly system: InMemoryWebhookSystem;
  readonly clock: ManualWebhookClock;
  readonly client: RecordingWebhookClient;
}

/** Build a server with the REAL composition path: config.webhooks = the in-memory system. */
export function buildWebhookServer(options: {
  readonly keys?: readonly StaticKeyConfig[];
  readonly clock?: ManualWebhookClock;
  readonly client?: RecordingWebhookClient;
  readonly handlers?: PartialHandlerPorts;
  readonly retry?: Partial<WebhookRetryOptions>;
} = {}): WebhookTestServer {
  const clock = options.clock ?? new ManualWebhookClock(1_000_000);
  const client = options.client ?? new RecordingWebhookClient();
  const system = createInMemoryWebhookSystem({
    httpClient: client,
    clock: () => clock.now(),
    retry: options.retry,
  });
  const app = buildServer({
    keys: options.keys ?? WEBHOOK_TEST_KEYS,
    clock: () => clock.now(),
    ...(options.handlers !== undefined ? { handlers: options.handlers } : {}),
    webhooks: system,
  });
  return { app, system, clock, client };
}

/** Auth + content-type headers for a key (mirrors fixtures.authHeaders). */
export function whHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${key}`, "content-type": "application/json", ...extra };
}

/** Auth-only headers (bodyless methods — DELETE parses no JSON body). */
export function whAuthOnly(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${key}`, ...extra };
}

/** Count webhook-relevant deliveries to one url (helper for multi-endpoint assertions). */
export function callsTo(client: RecordingWebhookClient, url: string): readonly RecordedWebhookCall[] {
  return client.calls.filter((call) => call.url === url);
}

let idemSequence = 0;
/** Fresh idempotency key per call (tests never collide on the replay map). */
export function freshWhIdem(prefix = "wh-idem"): string {
  idemSequence += 1;
  return `${prefix}-${idemSequence}`;
}
