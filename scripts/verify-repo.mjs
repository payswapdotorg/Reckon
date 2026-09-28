import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const required = [
  "AGENTS.md",
  "BOOTSTRAP.md",
  "README.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "docs/architecture/architecture-lock.md",
  "docs/architecture/reckon-frozen-architecture.md",
  "docs/architecture/contracts.md",
  "docs/architecture/dependency-graph.md",
  "docs/architecture/public-contract-map.md",
  "docs/handoff/TL3-HANDOFF.md",
  "docs/handoff/implementation-context.md",
  "docs/work-items/index.md",
  "docs/work-items/state.json",
  "docs/work-items/tl3-work-order.md",
  "docs/work-items/worker-1.md",
  "docs/work-items/worker-2.md",
  "docs/work-items/worker-3.md",
  "docs/decisions/ADR-001-persistence-events.md",
  "docs/decisions/ADR-002-model-adapter.md",
  "docs/decisions/ADR-003-consent-privacy.md",
  "docs/decisions/ADR-004-runtime-research.md"
];

const missing = required.filter(p => !fs.existsSync(path.join(root, p)));
if (missing.length) {
  console.error("Missing required repository files:");
  console.error(missing.join("\n"));
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(path.join(root, "docs/work-items/state.json"), "utf8"));
if (state.schemaVersion !== 1) throw new Error("Unsupported work-item state schema");
if (state.implementationComplete !== false) throw new Error("Initial scaffold must not claim implementation complete");

const ids = state.workItems.map(x => x.id);
if (new Set(ids).size !== ids.length) throw new Error("Duplicate work-item id");
for (const item of state.workItems) {
  if (!item.owner || !Array.isArray(item.dependsOn) || !item.status) {
    throw new Error("Malformed work-item: " + item.id);
  }
}

const docsDir = path.join(root, "docs");
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const suspicious = walk(docsDir)
  .filter(p => p.endsWith(".md") || p.endsWith(".json"))
  .filter(p => /turn\d+(?:search|news|image|business|product)/.test(fs.readFileSync(p, "utf8")));
if (suspicious.length) {
  console.error("Internal tool citation markers found in repository docs:");
  console.error(suspicious.map(p => path.relative(root, p)).join("\n"));
  process.exit(1);
}

console.log("Reckon repository governance check: PASS");
console.log(`Required files: ${required.length}`);
console.log(`Work items: ${state.workItems.length}`);
console.log("Implementation-complete flag: false");
