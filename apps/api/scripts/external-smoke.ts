/**
 * DEPLOY-003 — Gate N external production smoke test (deployment evidence).
 *
 * An EXTERNAL client (this host, outside the deployment) drives the FULL
 * Gate N sequence against the PUBLIC deployment URL:
 *
 *   authenticate → submit decision → receive decision → submit outcome →
 *   retrieve persistent evidence
 *
 * plus Gate M reachability for the API (and the web app when
 * RECKON_WEB_BASE_URL is set). The decision runs through the REAL kernel
 * chain over the deployed Neon persistence — this is the
 * deployed-infrastructure evidence class, not a mock.
 *
 * Depends on seed-demo.ts having run (candidates reference demo-item-reef).
 *
 * Run:
 *   RECKON_API_BASE_URL=https://reckon-api.<scope>.vercel.app \
 *   RECKON_API_KEY=<demo key> \
 *   [RECKON_WEB_BASE_URL=https://reckon-web.<scope>.vercel.app] \
 *   pnpm dlx tsx scripts/external-smoke.ts        # from apps/api
 */
import { createReckonClient } from "@reckon/sdk";

const baseUrl = process.env.RECKON_API_BASE_URL;
const apiKey = process.env.RECKON_API_KEY ?? process.env.RECKON_DEMO_API_KEY;
const webUrl = process.env.RECKON_WEB_BASE_URL;
const tag = process.env.RUN_TAG ?? `smoke-${Math.floor(Date.now() / 1000)}`;

if (baseUrl === undefined || baseUrl === "" || apiKey === undefined || apiKey === "") {
  console.error("external-smoke: RECKON_API_BASE_URL and RECKON_API_KEY are required");
  process.exit(1);
}

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error(`FAIL ${message}`);
}

// 1) Gate M — API reachability (unauthenticated health surface).
{
  const res = await fetch(`${baseUrl}/healthz`);
  const body = (await res.json()) as { ok?: boolean; version?: string };
  if (res.status === 200 && body.ok === true) {
    console.log(`OK   healthz: 200 ok=true version=${body.version} (${baseUrl})`);
  } else {
    fail(`healthz: status=${res.status} body=${JSON.stringify(body).slice(0, 120)}`);
  }
}

// 2) Readiness — the production composition must be fully wired.
{
  const res = await fetch(`${baseUrl}/readyz`);
  const body = (await res.json()) as { ok?: boolean; handlers?: Record<string, string> };
  const wired = Object.values(body.handlers ?? {}).every((state) => state === "wired");
  if (res.status === 200 && body.ok === true && wired) {
    console.log(`OK   readyz: 200 all handlers wired (${Object.keys(body.handlers ?? {}).length} ports)`);
  } else {
    fail(`readyz: status=${res.status} handlers=${JSON.stringify(body.handlers ?? {}).slice(0, 160)}`);
  }
}

const client = createReckonClient({ baseUrl, apiKey });
const now = Date.now();

// 3) Gate N — authenticate → submit decision → receive decision (real kernel chain).
let decisionId = "";
{
  const decision = await client.decisions.request({
    requestId: `${tag}-req`,
    tenant: { tenantId: "demo" },
    subject: { kind: "user", ref: "smoke-user" },
    objective: { objectiveId: "obj-relax", version: "1", kind: "relax", params: {} },
    attentionPolicy: { policyId: "att-balanced", version: "1", style: "balanced", params: {} },
    context: { contextId: "demo-ctx-evening" },
    candidates: {
      setId: `${tag}-cs`,
      candidates: [
        { itemId: "demo-item-reef", realizationIds: ["demo-real-1"], source: "smoke-retrieval" },
      ],
    },
    policySelector: { policyId: "pol-neutral", version: "1" },
    at: now,
    idempotencyKey: `${tag}-idem`,
  } as never);
  decisionId = decision.decisionId;
  const validAction = ["QUEUE", "SWITCH", "HOLD", "CONTINUE", "SUGGEST"].includes(decision.action);
  if (validAction && /^dec-/.test(decisionId)) {
    console.log(`OK   decision: action=${decision.action} decisionId=${decisionId}`);
  } else {
    fail(`decision: action=${decision.action} decisionId=${decisionId}`);
  }
}

// 4) Persistent evidence — read the decision back from durable storage.
{
  const fetched = await client.decisions.get(decisionId);
  if (fetched.decisionId === decisionId) {
    console.log(`OK   decision read-back: durable decisionId=${fetched.decisionId} action=${fetched.action}`);
  } else {
    fail(`decision read-back: got ${fetched.decisionId} expected ${decisionId}`);
  }
}

// 5) Submit outcome — durable at-least-once transport (evidence class fixture:
// a smoke run's synthetic completion is never presented as observed).
{
  const event = await client.outcomes.append({
    eventId: `${tag}-ev`,
    tenant: { tenantId: "demo" },
    subject: { kind: "user", ref: "smoke-user" },
    eventType: "completion",
    occurredAt: Date.now(),
    evidenceClass: "fixture",
    idempotencyKey: `${tag}-ev-idem`,
  } as never);
  if (event.eventId === `${tag}-ev`) {
    console.log(`OK   outcome: eventId=${event.eventId} (durable transport accepted)`);
  } else {
    fail(`outcome: eventId=${event.eventId}`);
  }
}

// 6) Evidence still retrievable after the write.
{
  const fetched = await client.decisions.get(decisionId);
  if (fetched.decisionId === decisionId) {
    console.log(`OK   evidence retrieval: decision ${decisionId} persisted across requests`);
  } else {
    fail(`evidence retrieval: decision ${decisionId} not retrievable after outcome write`);
  }
}

// 7) Gate M — web reachability (optional).
if (webUrl !== undefined && webUrl !== "") {
  const res = await fetch(webUrl);
  const html = await res.text();
  if (res.status === 200 && html.includes("Reckon")) {
    console.log(`OK   web: 200 "Reckon" served (${webUrl})`);
  } else {
    fail(`web: status=${res.status} containsReckon=${html.includes("Reckon")}`);
  }
}

if (failures > 0) {
  console.error(`external-smoke: FAIL — ${failures} check(s) failed (run=${tag} base=${baseUrl})`);
  process.exit(1);
}
console.log(
  `GATE-N: PASS — base=${baseUrl} decision=${decisionId} outcome=${tag}-ev run=${tag}${webUrl ? ` web=${webUrl}` : ""}`,
);
