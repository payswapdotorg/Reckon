/**
 * @reckon/agents — the Agent Body runtime (Worker 2 lane).
 *
 * W2-007: the model-neutral capability-envelope runtime that enforces
 * permissions, budgets (cost/tokens/wall-clock/calls) and latency
 * limits (soft → degrade, hard → yield) with typed errors. Ships only
 * the DeterministicTestExecutor (TEST INFRASTRUCTURE); real executors
 * arrive in later waves. Zero LLM calls; zero provider SDKs.
 */
export * from "./errors.js";
export * from "./contracts.js";
export * from "./runtime.js";
export * from "./deterministic-test-executor.js";
