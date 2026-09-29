/**
 * @reckon/agents — the Agent Body + Personal Agent runtime
 * (Worker 2 lane).
 *
 * W2-007: the model-neutral capability-envelope runtime that enforces
 * permissions, budgets (cost/tokens/wall-clock/calls) and latency
 * limits (soft → degrade, hard → yield) with typed errors. Ships only
 * the DeterministicTestExecutor (TEST INFRASTRUCTURE); real executors
 * arrive in later waves. Zero LLM calls; zero provider SDKs.
 *
 * W2-006: the Personal Agent runtime — one logical user agent across
 * permitted device bodies (N instances of the W2-007 runtime sharing
 * an agentId). Cross-device learning is explicit-grant-only (default
 * deny, ADR-003); location/attention enter only as permission FLAGS
 * (never raw values); the state-sync port ships an in-memory TEST
 * INFRASTRUCTURE adapter (production sync is a later wave).
 */
export * from "./errors.js";
export * from "./contracts.js";
export * from "./runtime.js";
export * from "./deterministic-test-executor.js";
export * from "./personal-agent.js";
