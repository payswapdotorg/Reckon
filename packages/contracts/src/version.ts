/**
 * Contract version registry.
 *
 * Rule (contracts.md #1): all public contracts are versioned. Every contract
 * object carries a `schema` field naming its contract id and version. The
 * version is a semver string; breaking changes to a frozen contract require
 * a new major version and an Architecture Change Record from TL3.
 */
export const CONTRACTS_VERSION = "0.1.0" as const;

export const CONTRACT_IDS = {
  decisionRequest: "reckon.decision-request",
  decisionResult: "reckon.decision-result",
  experience: "reckon.experience",
  outcomeEvent: "reckon.outcome-event",
  preferenceDelta: "reckon.preference-delta",
  agentBody: "reckon.agent-body",
  agentOrganization: "reckon.agent-organization",
  experiencePlan: "reckon.experience-plan",
  contextSnapshot: "reckon.context-snapshot",
  catalogItem: "reckon.catalog-item",
  realization: "reckon.realization",
} as const;

export type ContractId = (typeof CONTRACT_IDS)[keyof typeof CONTRACT_IDS];

/** Registry of current contract versions. Generated schemas and SDKs
 *  must be derived from this single source. */
export const CONTRACT_VERSIONS: Readonly<Record<ContractId, string>> =
  Object.freeze({
    [CONTRACT_IDS.decisionRequest]: "0.1.0",
    [CONTRACT_IDS.decisionResult]: "0.1.0",
    [CONTRACT_IDS.experience]: "0.1.0",
    [CONTRACT_IDS.outcomeEvent]: "0.1.0",
    [CONTRACT_IDS.preferenceDelta]: "0.1.0",
    [CONTRACT_IDS.agentBody]: "0.1.0",
    [CONTRACT_IDS.agentOrganization]: "0.1.0",
    [CONTRACT_IDS.experiencePlan]: "0.1.0",
    [CONTRACT_IDS.contextSnapshot]: "0.1.0",
    [CONTRACT_IDS.catalogItem]: "0.1.0",
    [CONTRACT_IDS.realization]: "0.1.0",
  });
