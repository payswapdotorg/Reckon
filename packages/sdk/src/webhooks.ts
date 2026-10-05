/**
 * @reckon/sdk — webhook helpers (S2-004).
 *
 * ONE CANONICAL ALGORITHM LAW: the signature scheme is implemented exactly
 * once, in `@reckon/contracts` (`verifyReckonSignature` — the reference
 * implementation, algorithmically identical to the docs samples in
 * apps/docs/src/content/webhooks.ts). This module RE-EXPORTS that
 * implementation — it never re-implements, forks or restates the scheme —
 * and adds the docs-named alias `verifyWebhook` so the snippets published
 * on the portal run verbatim against this package.
 *
 * Import shape documented by the portal:
 *   import { verifyWebhook } from "@reckon/sdk";
 *   const ok = verifyWebhook(rawBody, req.headers["reckon-signature"], whsec);
 */
import { verifyReckonSignature } from "@reckon/contracts";

export {
  generateWebhookSigningSecret,
  signWebhookPayload,
  verifyReckonSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_HEADER_CANONICAL,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  WEBHOOK_EVENT_TYPES,
  WebhookEventTypeSchema,
  ReckonEventSchema,
} from "@reckon/contracts";
export type {
  ReckonEvent,
  WebhookEndpointCreate,
  WebhookEndpointCreated,
  WebhookEndpointView,
  WebhookEventType,
  WebhookDeliveryView,
  WebhookReplayResponse,
  WebhookSigningSecret,
  WebhookUrl,
} from "@reckon/contracts";

/**
 * Verify a Reckon webhook delivery signature — the docs-named helper
 * (`verifyWebhook` in TypeScript; see the webhooks page's security
 * bullets). This is `verifyReckonSignature` from `@reckon/contracts`,
 * re-exported under the documented name: parse `t=`/`v1=` from the
 * comma-separated `Reckon-Signature` header, enforce the timestamp
 * tolerance (default 300s) against the clock, recompute the HMAC-SHA256
 * over `"{t}.{rawBody}"` with the endpoint's `whsec_…` secret and compare
 * in CONSTANT TIME.
 *
 * @param rawBody the RAW request body exactly as delivered (before any
 *   JSON parsing/re-serialization — re-serialized JSON does not match).
 * @param header the `Reckon-Signature` header value (`t=<unix>,v1=<hex>`).
 * @param secret the endpoint's signing secret (`whsec_…`).
 * @param toleranceSeconds replay-window guard (default 300).
 * @param nowMs injectable clock for deterministic tests (default Date.now()).
 */
export const verifyWebhook = verifyReckonSignature;
