/**
 * Generates JSON Schema (draft 2020-12) files for every frozen public
 * contract into packages/contracts/schemas/. Run via
 * `pnpm --filter @reckon/contracts generate:schemas`.
 *
 * This is the "generated-schema mechanism" frozen by CONTRACT-001:
 * OpenAPI documents and SDK types must be derived from these outputs
 * (or directly from the zod schemas) — never hand-written in parallel.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import {
  DecisionRequestSchema,
  DecisionResultSchema,
  ExperienceSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  AgentBodySchema,
  AgentOrganizationSchema,
  ExperiencePlanSchema,
  ContextSnapshotSchema,
  CatalogItemSchema,
  RealizationSchema,
} from "./index.js";

const OUT_DIR = join(import.meta.dirname, "..", "schemas");

const targets: Record<string, z.ZodTypeAny> = {
  "decision-request.schema.json": DecisionRequestSchema,
  "decision-result.schema.json": DecisionResultSchema,
  "experience.schema.json": ExperienceSchema,
  "outcome-event.schema.json": OutcomeEventSchema,
  "preference-delta.schema.json": PreferenceDeltaSchema,
  "agent-body.schema.json": AgentBodySchema,
  "agent-organization.schema.json": AgentOrganizationSchema,
  "experience-plan.schema.json": ExperiencePlanSchema,
  "context-snapshot.schema.json": ContextSnapshotSchema,
  "catalog-item.schema.json": CatalogItemSchema,
  "realization.schema.json": RealizationSchema,
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, schema] of Object.entries(targets)) {
  const jsonSchema = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) as unknown as Record<string, unknown>;
  jsonSchema.$id = `https://reckon.dev/schemas/${file}`;
  writeFileSync(join(OUT_DIR, file), JSON.stringify(jsonSchema, null, 2) + "\n");
  console.log(`wrote schemas/${file}`);
}
console.log(`done: ${Object.keys(targets).length} schemas`);
