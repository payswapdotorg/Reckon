import { z } from "zod/v4";
import { IdSchema, ProvenanceSchema } from "./primitives.js";
import {
  AgentBodySchema,
  BudgetSpecSchema,
  EvaluatorRefSchema,
} from "./agents.js";

/**
 * AgentOrganization — a directed graph of Agent Bodies with
 * communication/delegation edges, shared/private memory topology,
 * model assignment, budgets, termination rules, evaluator and
 * capability dependencies (contracts.md).
 */
export const DelegationEdgeSchema = z.object({
  edgeId: z.string().min(1).max(128),
  fromBodyId: IdSchema,
  toBodyId: IdSchema,
  kind: z.enum(["communicate", "delegate", "report", "escalate", "custom"]),
  customKind: z.string().min(1).max(64).optional(),
  /** Message contract the edge carries (opaque to core). */
  messageContract: z.string().min(1).max(256).optional(),
});
export type DelegationEdge = z.infer<typeof DelegationEdgeSchema>;

export const MemoryTopologySchema = z.object({
  /** Which memory interfaces are shared across which bodies. */
  sharedMemories: z
    .array(
      z.object({
        memoryId: z.string().min(1).max(128),
        bodyIds: z.array(IdSchema).min(1),
      })
    )
    .default([]),
  /** Explicitly private memories (never synchronized). */
  privateMemories: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type MemoryTopology = z.infer<typeof MemoryTopologySchema>;

export const ModelAssignmentSchema = z.object({
  bodyId: IdSchema,
  /** Model adapter id — one provider-neutral model router only (ADR-002). */
  modelAdapterId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(128),
  version: z.string().min(1).max(64).default("1"),
});
export type ModelAssignment = z.infer<typeof ModelAssignmentSchema>;

export const TerminationRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("max-depth"), maxDepth: z.number().int().positive() }),
  z.object({ kind: z.literal("budget-exhausted"), budgetId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal("deadline"), deadlineMs: z.number().positive() }),
  z.object({
    kind: z.literal("consensus"),
    /** Fraction of evaluator bodies that must agree (0..1). */
    threshold: z.number().min(0).max(1),
  }),
  z.object({ kind: z.literal("task-complete") }),
  z.object({
    kind: z.literal("custom"),
    ruleId: z.string().min(1).max(128),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
]);
export type TerminationRule = z.infer<typeof TerminationRuleSchema>;

export const AgentOrganizationSchema = z.object({
  schema: z.literal("reckon.agent-organization").default("reckon.agent-organization"),
  schemaVersion: z.string().default("0.1.0"),
  organizationId: IdSchema,
  version: z.string().min(1).max(64).default("1"),
  bodies: z.array(AgentBodySchema).min(1),
  edges: z.array(DelegationEdgeSchema).default([]),
  memoryTopology: MemoryTopologySchema.default({ sharedMemories: [], privateMemories: [] }),
  modelAssignments: z.array(ModelAssignmentSchema).default([]),
  budgets: z.array(BudgetSpecSchema).default([]),
  terminationRules: z.array(TerminationRuleSchema).min(1),
  evaluator: EvaluatorRefSchema.optional(),
  /** Capability dependencies that must be available to run this org. */
  capabilityDependencies: z.array(z.string().min(1).max(128)).default([]),
  provenance: ProvenanceSchema.optional(),
});
export type AgentOrganization = z.infer<typeof AgentOrganizationSchema>;
