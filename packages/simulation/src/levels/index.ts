/**
 * SIM-002 — the ladder Levels 1–4 module (Wave A, W1).
 *
 * Exports the four synthetic-host level cases for the Reckon-Complete
 * ladder (docs/simulations/reckon-complete-ladder.md):
 *
 *   Level 1 — static catalog picker   (packages/simulation/src/levels/level-1-static-catalog.ts)
 *   Level 2 — simple content feed     (…/level-2-content-feed.ts)
 *   Level 3 — e-commerce storefront   (…/level-3-storefront.ts)
 *   Level 4 — notification system     (…/level-4-notifications.ts)
 *
 * plus the canonical Wave A fixtures, the wave runner, the sealed wave
 * scorecard, and the machine-generated report tables
 * (…/wave-a.ts). See docs/simulations/sim-002-levels-1-4.md.
 *
 * Laws: the level hosts are SYNTHETIC hosts on the SIM-001 common
 * harness — they import only @reckon/contracts types and the harness
 * host-adapter seam (zero internal Reckon packages), they contain no
 * wall-clock reads or unseeded randomness, and every synthetic outcome
 * they produce is evidenceClass "fixture" (never observed evidence).
 */

export {
  level1StaticCatalogProfile,
  createLevel1StaticCatalogHost,
  level1StaticCatalogMeta,
  type Level1Host,
  type Level1WorldView,
} from "./level-1-static-catalog.js";

export {
  level2ContentFeedProfile,
  createLevel2ContentFeedHost,
  level2ContentFeedMeta,
  type Level2Host,
  type Level2WorldView,
} from "./level-2-content-feed.js";

export {
  level3StorefrontProfile,
  createLevel3StorefrontHost,
  level3StorefrontMeta,
  type Level3Host,
  type Level3WorldView,
} from "./level-3-storefront.js";

export {
  level4NotificationsProfile,
  createLevel4NotificationsHost,
  level4NotificationsMeta,
  type Level4Host,
  type Level4WorldView,
} from "./level-4-notifications.js";

export {
  LADDER_WAVE_A_FIXTURES,
  LADDER_WAVE_A_ENSEMBLE_SEEDS,
  LADDER_WAVE_A_CASES,
  runLadderLevelFixture,
  runCanonicalLadderWaveA,
  renderLadderWaveAMarkdownTable,
  renderLadderWaveAGapsTable,
  renderLadderWaveAScorecardSummary,
  type LadderLevelFixture,
  type LadderLevelCase,
  type LadderWaveRun,
  type LadderWaveAResult,
} from "./wave-a.js";

// ---------------------------------------------------------------------------
// SIM-004 — Wave B (W3): ladder Levels 9–12 + the API-only measurement
// driver. Additive extension; no exported shape above changes.
// ---------------------------------------------------------------------------

export {
  level9FoodDeliveryProfile,
  createLevel9FoodDeliveryHost,
  level9FoodDeliveryMeta,
  type Level9Host,
  type Level9WorldView,
} from "./level-9-food-delivery.js";

export {
  level10MobilityProfile,
  createLevel10MobilityHost,
  level10MobilityMeta,
  type Level10Host,
  type Level10WorldView,
} from "./level-10-mobility.js";

export {
  level11SocialFeedProfile,
  createLevel11SocialFeedHost,
  level11SocialFeedMeta,
  type Level11Host,
  type Level11WorldView,
} from "./level-11-social-feed.js";

export {
  level12FinanceProfile,
  createLevel12FinanceHost,
  level12FinanceMeta,
  type Level12Host,
  type Level12WorldView,
} from "./level-12-finance.js";

export {
  LADDER_WAVE_B_FIXTURES,
  LADDER_WAVE_B_ENSEMBLE_SEEDS,
  LADDER_WAVE_B_CASES,
  runLadderWaveBLevelFixture,
  runCanonicalLadderWaveB,
  renderLadderWaveBMarkdownTable,
  renderLadderWaveBGapsTable,
  renderLadderWaveBScorecardSummary,
  crossWaveRecurringGaps,
  renderCrossWaveRecurringGapsTable,
  type LadderWaveBResult,
  type LadderWaveBRun,
} from "./wave-b.js";

// ---------------------------------------------------------------------------
// SIM-005 — Wave C-1 (W1): ladder Levels 13–16 + the canonical Wave C
// fixtures/runner/scorecard and the cross-wave 3-domain analysis
// extended through Wave C. Additive extension; no exported shape above
// changes (parallel-safety: SIM-006 owns Levels 17–20 + wave-d.ts on
// its own branch — nothing here touches them).
// ---------------------------------------------------------------------------

export {
  level13HealthcareProfile,
  createLevel13HealthcareHost,
  level13HealthcareMeta,
  type Level13Host,
  type Level13WorldView,
} from "./level-13-healthcare.js";

export {
  level14EducationProfile,
  createLevel14EducationHost,
  level14EducationMeta,
  type Level14Host,
  type Level14WorldView,
} from "./level-14-education.js";

export {
  level15B2bSaasProfile,
  createLevel15B2bSaasHost,
  level15B2bSaasMeta,
  type Level15Host,
  type Level15WorldView,
} from "./level-15-b2b-saas.js";

export {
  level16EnterpriseWorkflowProfile,
  createLevel16EnterpriseWorkflowHost,
  level16EnterpriseWorkflowMeta,
  type Level16Host,
  type Level16WorldView,
} from "./level-16-enterprise-workflow.js";

export {
  LADDER_WAVE_C_FIXTURES,
  LADDER_WAVE_C_ENSEMBLE_SEEDS,
  LADDER_WAVE_C_CASES,
  runLadderWaveCLevelFixture,
  runCanonicalLadderWaveC,
  renderLadderWaveCMarkdownTable,
  renderLadderWaveCGapsTable,
  renderLadderWaveCScorecardSummary,
  crossWaveRecurringGapsThroughWaveC,
  renderCrossWaveRecurringGapsThroughWaveCTable,
  type LadderWaveCResult,
  type LadderWaveCRun,
} from "./wave-c.js";
