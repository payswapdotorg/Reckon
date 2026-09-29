import { z } from "zod/v4";
import { IdSchema, ProvenanceSchema } from "./primitives.js";

/**
 * AgentBody — an executable capability envelope (frozen architecture §3,
 * contracts.md): observations, tools, memory interfaces, permissions,
 * budgets, latency limits, action contracts, evaluator, simulator
 * implementation and real implementation. Model-NEUTRAL (ADR-002):
 * `Agent Body + selected LLM/model + permitted capabilities = Agent Instance`.
 */
export const PermissionSchema = z.object({
  permissionId: z.string().min(1).max(128),
  /** Neutral capability vocabulary; custom stays adapter-private. */
  capability: z.enum([
    "observe",
    "read",
    "write",
    "tool",
    "network",
    "model-inference",
    "memory",
    "custom",
  ]),
  customCapability: z.string().min(1).max(64).optional(),
  /** Scoped target (opaque to core; host interprets). */
  scope: z.string().min(1).max(256).optional(),
  grantedBy: z.string().min(1).max(128).optional(),
});
export type Permission = z.infer<typeof PermissionSchema>;

export const BudgetSpecSchema = z.object({
  /** Budget kind: cost, tokens, wall-clock, calls. */
  kind: z.enum(["cost", "tokens", "wall-clock-ms", "calls", "custom"]),
  customKind: z.string().min(1).max(64).optional(),
  limit: z.number().positive(),
  currency: z.string().length(3).optional(),
});
export type BudgetSpec = z.infer<typeof BudgetSpecSchema>;

export const LatencyLimitSchema = z.object({
  /** Soft deadline before degradation (e.g. fallback to cached answer). */
  softMs: z.number().positive().optional(),
  /** Hard deadline after which the body must yield. */
  hardMs: z.number().positive(),
});
export type LatencyLimit = z.infer<typeof LatencyLimitSchema>;

export const MemoryInterfaceSchema = z.object({
  memoryId: z.string().min(1).max(128),
  kind: z.enum(["private", "shared", "ephemeral", "persistent", "custom"]),
  customKind: z.string().min(1).max(64).optional(),
  /** Read/write access declaration. */
  access: z.enum(["read", "write", "read-write"]),
});
export type MemoryInterface = z.infer<typeof MemoryInterfaceSchema>;

export const ToolRefSchema = z.object({
  toolId: z.string().min(1).max(128),
  /** Host/adapter tool name (opaque to core). */
  name: z.string().min(1).max(128),
  inputContract: z.string().min(1).max(256).optional(),
  permissions: z.array(PermissionSchema).default([]),
});
export type ToolRef = z.infer<typeof ToolRefSchema>;

export const ObservationSpecSchema = z.object({
  observationId: z.string().min(1).max(128),
  /** What signal this body may observe (neutral vocabulary). */
  kind: z.enum(["context", "outcome", "preference", "catalog", "system", "custom"]),
  customKind: z.string().min(1).max(64).optional(),
});
export type ObservationSpec = z.infer<typeof ObservationSpecSchema>;

export const ActionContractSchema = z.object({
  actionId: z.string().min(1).max(128),
  /** Neutral action vocabulary aligned with scheduler decisions. */
  kind: z.enum([
    "select",
    "queue",
    "switch",
    "suggest",
    "interrupt",
    "resume",
    "end",
    "explore",
    "ask",
    "custom",
  ]),
  customKind: z.string().min(1).max(64).optional(),
  /** Typed payload contract id (opaque to core). */
  payloadContract: z.string().min(1).max(256).optional(),
});
export type ActionContract = z.infer<typeof ActionContractSchema>;

export const EvaluatorRefSchema = z.object({
  evaluatorId: z.string().min(1).max(128),
  version: z.string().min(1).max(64).default("1"),
});
export type EvaluatorRef = z.infer<typeof EvaluatorRefSchema>;

export const AgentBodySchema = z.object({
  schema: z.literal("reckon.agent-body").default("reckon.agent-body"),
  schemaVersion: z.string().default("0.1.0"),
  bodyId: IdSchema,
  version: z.string().min(1).max(64).default("1"),
  /** Role contract — what this body is responsible for. */
  role: z.object({
    roleId: z.string().min(1).max(128),
    description: z.string().min(1).max(1024),
  }),
  observations: z.array(ObservationSpecSchema).default([]),
  tools: z.array(ToolRefSchema).default([]),
  permissions: z.array(PermissionSchema).default([]),
  memoryInterfaces: z.array(MemoryInterfaceSchema).default([]),
  actions: z.array(ActionContractSchema).default([]),
  budgets: z.array(BudgetSpecSchema).default([]),
  latencyLimits: LatencyLimitSchema.optional(),
  evaluator: EvaluatorRefSchema.optional(),
  /** Simulator implementation reference (research runtime). */
  simulatorImplementation: z
    .object({
      kind: z.string().min(1).max(64),
      ref: z.string().min(1).max(512),
    })
    .optional(),
  /** Real implementation reference (production runtime). */
  realImplementation: z
    .object({
      kind: z.string().min(1).max(64),
      ref: z.string().min(1).max(512),
    })
    .optional(),
  provenance: ProvenanceSchema.optional(),
});
export type AgentBody = z.infer<typeof AgentBodySchema>;
