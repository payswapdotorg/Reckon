/**
 * W3-004 apps/api composition: emit observability records from the
 * decision/outcome/scheduler paths through the ObservabilitySink port.
 *
 * COMPOSITION ONLY — route contracts stay frozen; these wrappers sit on
 * the injectable handler ports (the seams W3-001 built). Latency is
 * computed from the INJECTED clock around handler execution
 * (`latencySource: "injected-clock"` on every decision record).
 */
import { ObservabilityRecorder } from "@reckon/observability";
import type { ObservabilityClock } from "@reckon/observability";
import { ApiError } from "./errors.js";
import type { DecisionHandler, OutcomeIngestHandler } from "./ports.js";

export interface ObservationDeps {
  readonly recorder: ObservabilityRecorder;
  readonly clock: ObservabilityClock;
}

/** Standard error summary for records (code + message, never raw throws). */
function errorSummary(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Decision path wrapper: records decision latency (injected clock),
 * policy/version, uncertainty and cost from the result; emits a
 * scheduler-action record when the result carries a scheduleDelta; emits
 * an error-decorated decision record when the handler fails (then
 * rethrows — the route contract is unchanged).
 */
export function observedDecisionHandler(handler: DecisionHandler, deps: ObservationDeps): DecisionHandler {
  return {
    decide: async (request, auth) => {
      const startedAt = deps.clock();
      try {
        const result = await handler.decide(request, auth);
        const latencyMs = deps.clock() - startedAt;
        deps.recorder.recordDecision({ request, result, latencyMs });
        if (result.scheduleDelta !== undefined) {
          deps.recorder.recordSchedulerAction({
            source: "decision",
            action: result.scheduleDelta.action,
            tenant: result.tenant,
            decisionId: result.decisionId,
            ...(result.scheduleDelta.planId !== undefined ? { planId: result.scheduleDelta.planId } : {}),
            scheduleDelta: result.scheduleDelta,
          });
        }
        return result;
      } catch (error) {
        const latencyMs = deps.clock() - startedAt;
        deps.recorder.recordDecision({ request, latencyMs, error: errorSummary(error) });
        throw error;
      }
    },
  };
}

/**
 * Outcome path wrapper: records the outcome-linkage record for the
 * event the handler returns (for transport-backed handlers that is the
 * stored — or duplicate-collapsed ORIGINAL — event); emits an error
 * record (scope "handler") when ingestion fails (then rethrows).
 */
export function observedOutcomeIngest(handler: OutcomeIngestHandler, deps: { recorder: ObservabilityRecorder }): OutcomeIngestHandler {
  return {
    ingest: async (event, auth) => {
      try {
        const stored = await handler.ingest(event, auth);
        deps.recorder.recordOutcome({ event: stored });
        return stored;
      } catch (error) {
        const summary = errorSummary(error);
        deps.recorder.recordError({
          scope: "handler",
          code: summary.code,
          message: summary.message,
          tenant: event.tenant,
        });
        throw error;
      }
    },
  };
}

/** Telemetry must never mask the real API error (safe record helper). */
export function recordRouteErrorSafely(
  recorder: ObservabilityRecorder,
  input: {
    readonly code: string;
    readonly message: string;
    readonly route: string;
    readonly tenant?: { readonly tenantId: string; readonly workspaceId?: string };
  },
): void {
  try {
    recorder.recordError({
      scope: "route",
      code: input.code,
      message: input.message,
      route: input.route,
      ...(input.tenant !== undefined ? { tenant: input.tenant } : {}),
    });
  } catch (telemetryError) {
    process.stderr.write(
      `reckon-api: observability record failed (${telemetryError instanceof Error ? telemetryError.message : String(telemetryError)}); the API error response is unaffected\n`,
    );
  }
}
