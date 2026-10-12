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
