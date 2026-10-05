import type { WebhookHttpClient, WebhookHttpResponse } from "./ports.js";
import { WEBHOOK_DELIVERY_TIMEOUT_MS } from "@reckon/contracts";

/**
 * S2-002 — the fetch-based outbound delivery client (production
 * adapter for the WebhookHttpClient port; Node 22+ global fetch).
 *
 * - Sends the raw body BYTE-FOR-BYTE (the signature covers exactly
 *   those bytes) with the supplied headers.
 * - Measures latency with the monotonic performance clock.
 * - Non-2xx statuses are RETURNED (the engine decides retries);
 *   transport failures (network, DNS, TLS, timeout) are THROWN.
 *
 * SSRF NOTE (host responsibility, documented in the README): this
 * adapter fetches whatever https URL the tenant registered. A host
 * exposed to untrusted tenants should wrap it with egress filtering
 * (private-range / link-local / loopback denial) at the network edge —
 * the API layer never invents that policy (architecture lock: the host
 * owns its own security posture).
 */
export class FetchWebhookHttpClient implements WebhookHttpClient {
  readonly #fetch: typeof globalThis.fetch;

  constructor(fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)) {
    this.#fetch = fetchImpl;
  }

  async post(
    url: string,
    headers: Record<string, string>,
    rawBody: string,
    options?: { readonly timeoutMs?: number },
  ): Promise<WebhookHttpResponse> {
    const timeoutMs = options?.timeoutMs ?? WEBHOOK_DELIVERY_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await this.#fetch(url, {
        method: "POST",
        headers,
        body: rawBody,
        signal: controller.signal,
        redirect: "manual",
      });
      // Drain the body (bounded) so the connection is reusable, then ignore it.
      await response.arrayBuffer().catch(() => undefined);
      return { statusCode: response.status, latencyMs: Math.round(performance.now() - startedAt) };
    } finally {
      clearTimeout(timer);
    }
  }
}
