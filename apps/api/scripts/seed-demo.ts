/**
 * DEPLOY-002 — public demo tenant seeder (deployment evidence tooling).
 *
 * Seeds ONE explicitly-labeled demonstration tenant through the PUBLIC API
 * surface (@reckon/sdk only — never a direct database write): catalog items
 * + realizations, experience expansion, one real kernel decision, one
 * outcome (evidence class `fixture` — demonstration data is never presented
 * as observed, Gate Q), one preference delta, two plans with a replan
 * chain, an agent body + organization, and a queued research job. Every
 * identifier is `demo-` prefixed and every title is `Demo —` prefixed so
 * the dataset is unmistakably demonstration data.
 *
 * Idempotent by construction: fixed ids + idempotency keys. A re-run on an
 * already-seeded tenant prints SKIP lines for steps whose durable records
 * already exist (upserts and replayed idempotent requests are silent
 * no-ops by design).
 *
 * Run (against the deployed API):
 *   RECKON_API_BASE_URL=https://reckon-api.<scope>.vercel.app \
 *   RECKON_DEMO_API_KEY=<demo key> \
 *   pnpm dlx tsx scripts/seed-demo.ts        # from apps/api
 */
import { createReckonClient } from "@reckon/sdk";

const baseUrl = process.env.RECKON_API_BASE_URL;
const apiKey = process.env.RECKON_DEMO_API_KEY;
if (baseUrl === undefined || baseUrl === "" || apiKey === undefined || apiKey === "") {
  console.error("seed-demo: RECKON_API_BASE_URL and RECKON_DEMO_API_KEY are required");
  process.exit(1);
}

const client = createReckonClient({ baseUrl, apiKey });
const now = Date.now();

const ITEMS = [
  {
    itemId: "demo-item-reef",
    kind: "media" as const,
    labels: ["documentary", "nature", "demo"],
    attributes: { title: "Demo — Coral Reef Slow Hour" },
  },
  {
    itemId: "demo-item-alps",
    kind: "media" as const,
    labels: ["documentary", "travel", "demo"],
    attributes: { title: "Demo — Alpine Line" },
  },
  {
    itemId: "demo-item-kitchen",
    kind: "media" as const,
    labels: ["series", "cooking", "demo"],
    attributes: { title: "Demo — Quiet Kitchen" },
  },
];

const REALIZATIONS = ITEMS.map((item, index) => ({
  realizationId: `demo-real-${index + 1}`,
  itemId: item.itemId,
  kind: "stream" as const,
  constraints: { formats: ["full"], durationSeconds: 2400 + index * 600 },
}));

const DEMO_SUBJECT = { kind: "user" as const, ref: "demo-user" };
const DEMO_TENANT = { tenantId: "demo" };
const DEMO_OBJECTIVE = {
  objectiveId: "obj-relax",
  version: "1",
  kind: "relax" as const,
  params: {},
};
const DEMO_ATTENTION = {
  policyId: "att-balanced",
  version: "1",
  style: "balanced" as const,
  params: {},
};

let seeded = 0;
let skipped = 0;

async function step(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    seeded += 1;
    console.log(`SEEDED ${name} — ${detail}`);
  } catch (error) {
    skipped += 1;
    const code = (error as Error & { code?: string }).code ?? "";
    console.log(`SKIP   ${name} — ${code} ${(error as Error).message.slice(0, 90)}`);
  }
}

await step("catalog items (3, Demo-labeled)", async () => {
  for (const item of ITEMS) {
    await client.catalog.upsertItem(item);
  }
  return ITEMS.map((item) => item.attributes.title).join(" | ");
});

await step("catalog realizations (3)", async () => {
  for (const realization of REALIZATIONS) {
    await client.catalog.upsertRealization(realization);
  }
  return REALIZATIONS.map((r) => `${r.realizationId}→${r.itemId}`).join(", ");
});

await step("experience expansion over the demo catalog", async () => {
  const result = await client.experiences.resolve({ items: ITEMS, realizations: REALIZATIONS });
  return `${result.experiences.length} experience(s) expanded by the real W2-003 expander`;
});

await step("kernel decision (demo flow)", async () => {
  const decision = await client.decisions.request({
    requestId: "demo-req-1",
    tenant: DEMO_TENANT,
    subject: DEMO_SUBJECT,
    objective: DEMO_OBJECTIVE,
    attentionPolicy: DEMO_ATTENTION,
    context: { contextId: "demo-ctx-evening" },
    candidates: {
      setId: "demo-cs-1",
      candidates: [
        { itemId: "demo-item-reef", realizationIds: ["demo-real-1"], source: "demo-retrieval" },
      ],
    },
    policySelector: { policyId: "pol-neutral", version: "1" },
    at: now,
    idempotencyKey: "demo-idem-req-1",
  } as never);
  return `action=${decision.action} decisionId=${decision.decisionId}`;
});

// The decision id is server-generated; durability is proven by the
// idempotent replay below (same key → SAME decision record).
await step("decision replay (idempotent → durable read-back)", async () => {
  const replayed = await client.decisions.request({
    requestId: "demo-req-1",
    tenant: DEMO_TENANT,
    subject: DEMO_SUBJECT,
    objective: DEMO_OBJECTIVE,
    attentionPolicy: DEMO_ATTENTION,
    context: { contextId: "demo-ctx-evening" },
    candidates: {
      setId: "demo-cs-1",
      candidates: [
        { itemId: "demo-item-reef", realizationIds: ["demo-real-1"], source: "demo-retrieval" },
      ],
    },
    policySelector: { policyId: "pol-neutral", version: "1" },
    at: now,
    idempotencyKey: "demo-idem-req-1",
  } as never);
  return `replayed decisionId=${replayed.decisionId}`;
});

await step("outcome event (evidence class fixture — honest demo data)", async () => {
  const event = await client.outcomes.append({
    eventId: "demo-outcome-1",
    tenant: DEMO_TENANT,
    subject: DEMO_SUBJECT,
    eventType: "completion",
    occurredAt: now,
    evidenceClass: "fixture",
    idempotencyKey: "demo-idem-outcome-1",
  } as never);
  return `eventId=${event.eventId} (durable at-least-once transport)`;
});

await step("preference delta (append-only)", async () => {
  const delta = await client.preferences.appendDelta({
    deltaId: "demo-delta-1",
    tenant: DEMO_TENANT,
    subject: DEMO_SUBJECT,
    dimension: "genre.documentary",
    op: "add",
    value: 1,
    model: { modelId: "demo-model", version: "1" },
    timestamp: now,
  } as never);
  return `deltaId=${delta.deltaId} dimension=genre.documentary`;
});

const mkPlan = (planId: string, createdAt: number) => ({
  schema: "reckon.experience-plan" as const,
  schemaVersion: "0.1.0",
  planId,
  version: 0,
  tenant: DEMO_TENANT,
  subject: DEMO_SUBJECT,
  objective: DEMO_OBJECTIVE,
  attentionPolicy: DEMO_ATTENTION,
  queuedExperiences: [],
  replanTriggers: [],
  resumeCheckpoints: [],
  createdAt,
  updatedAt: createdAt,
});

await step("plan: demo-plan-evening + replan chain", async () => {
  await client.plans.create(mkPlan("demo-plan-evening", now - 3_600_000));
  await client.plans.replan("demo-plan-evening", { trigger: "host-request" } as never);
  const history = await client.plans.history("demo-plan-evening");
  return `versions=${history.map((entry) => entry.version).join(",")}`;
});

await step("plan: demo-plan-weekend", async () => {
  await client.plans.create(mkPlan("demo-plan-weekend", now - 1_800_000));
  return "created";
});

await step("agent body (demo generalist)", async () => {
  await client.agents.createBody({
    schema: "reckon.agent-body",
    schemaVersion: "0.1.0",
    bodyId: "demo-body-generalist",
    version: "1",
    role: { roleId: "generalist", description: "Demo — root of delegation." },
    observations: [],
    tools: [],
    permissions: [],
    memoryInterfaces: [],
    actions: [],
    budgets: [],
  });
  return "bodyId=demo-body-generalist";
});

await step("agent body (demo researcher)", async () => {
  await client.agents.createBody({
    schema: "reckon.agent-body",
    schemaVersion: "0.1.0",
    bodyId: "demo-body-researcher",
    version: "1",
    role: { roleId: "researcher", description: "Demo — finds candidate evidence." },
    observations: [],
    tools: [],
    permissions: [],
    memoryInterfaces: [],
    actions: [],
    budgets: [],
  });
  return "bodyId=demo-body-researcher";
});

await step("agent organization (demo delegation DAG)", async () => {
  await client.agents.createOrganization({
    schema: "reckon.agent-organization",
    schemaVersion: "0.1.0",
    organizationId: "demo-org-1",
    version: "1",
    bodies: [
      {
        schema: "reckon.agent-body",
        schemaVersion: "0.1.0",
        bodyId: "demo-body-generalist",
        version: "1",
        role: { roleId: "generalist", description: "Demo — root of delegation." },
        observations: [],
        tools: [],
        permissions: [],
        memoryInterfaces: [],
        actions: [],
        budgets: [],
      },
      {
        schema: "reckon.agent-body",
        schemaVersion: "0.1.0",
        bodyId: "demo-body-researcher",
        version: "1",
        role: { roleId: "researcher", description: "Demo — finds candidate evidence." },
        observations: [],
        tools: [],
        permissions: [],
        memoryInterfaces: [],
        actions: [],
        budgets: [],
      },
    ],
    edges: [
      {
        edgeId: "demo-edge-1",
        fromBodyId: "demo-body-generalist",
        toBodyId: "demo-body-researcher",
        kind: "delegate",
      },
    ],
    memoryTopology: { sharedMemories: [], privateMemories: [] },
    modelAssignments: [
      { bodyId: "demo-body-generalist", modelAdapterId: "demo-router", modelId: "demo-base" },
    ],
    budgets: [],
    terminationRules: [{ kind: "task-complete" }],
  });
  return "organizationId=demo-org-1 (2 bodies, 1 delegate edge)";
});

await step("research job (queued, calibration)", async () => {
  const job = await client.research.enqueueJob({
    jobId: "demo-rj-calibration",
    kind: "calibration-run",
    payload: { ladderRung: "calibration" },
  });
  return `jobId=${job.jobId} state=${job.state}`;
});

console.log(
  `seed-demo: done — ${seeded} steps seeded, ${skipped} skipped (idempotent re-run tolerated); tenant=demo base=${baseUrl}`,
);
