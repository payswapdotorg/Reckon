/**
 * W2-001 acceptance tests — candidate normalization.
 *
 * Proves: (itemId, source) dedup, deterministic ordering (rankHint desc
 * then itemId then source), honest absence (never invented), typed
 * errors on invalid input (never raw throws), and determinism via
 * content digests (identical + permuted inputs).
 */
import { describe, expect, it } from "vitest";
import {
  CatalogItemSchema,
  contentDigest,
  RealizationSchema,
  type CatalogItem,
  type Realization,
} from "@reckon/contracts";
import { createCandidateNormalizer, normalizeCandidates } from "../src/index.js";

const tenant = { tenantId: "t-1" };

function item(itemId: string, labels: string[] = []): CatalogItem {
  return CatalogItemSchema.parse({ itemId, kind: "media", labels });
}

function realization(realizationId: string, itemId: string): Realization {
  return RealizationSchema.parse({ realizationId, itemId, kind: "stream", constraints: {} });
}

function candidateSet(
  entries: {
    itemId: string;
    realizationIds?: string[];
    source: string;
    rankHint?: number;
    scoreHint?: number;
  }[],
) {
  return {
    setId: "cs-1",
    candidates: entries.map((e) => ({
      itemId: e.itemId,
      realizationIds: e.realizationIds ?? [],
      source: e.source,
      ...(e.rankHint !== undefined ? { rankHint: e.rankHint } : {}),
      ...(e.scoreHint !== undefined ? { scoreHint: e.scoreHint } : {}),
    })),
  };
}

const normalizer = createCandidateNormalizer();

describe("W2-001 normalization: dedup", () => {
  it("merges duplicate (itemId, source) candidates into one record with unioned realizations and max hints", () => {
    const result = normalizer.normalize({
      candidates: candidateSet([
        { itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval", rankHint: 3 },
        { itemId: "item-1", realizationIds: ["real-2"], source: "host-retrieval", rankHint: 7, scoreHint: 0.5 },
      ]),
      items: [item("item-1")],
      realizations: [realization("real-1", "item-1"), realization("real-2", "item-1")],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(1);
    const record = result.value[0];
    expect(record.itemId).toBe("item-1");
    expect(record.realizationIds).toEqual(["real-1", "real-2"]);
    expect(record.rankHint).toBe(7);
    expect(record.scoreHint).toBe(0.5);
    expect(record.availability).toEqual({ available: true });
    expect(record.key).toBe(JSON.stringify(["item-1", "host-retrieval"]));
  });

  it("keeps the same item from different sources as separate records", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([
        { itemId: "item-1", source: "host-retrieval" },
        { itemId: "item-1", source: "exploration" },
      ]),
      items: [item("item-1")],
      realizations: [realization("real-1", "item-1")],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(2);
    expect(new Set(result.value.map((c) => c.source))).toEqual(new Set(["host-retrieval", "exploration"]));
    expect(new Set(result.value.map((c) => c.key)).size).toBe(2);
  });

  it("drops candidate-preferred realizationIds that do not exist in the host truth (honest absence)", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([{ itemId: "item-1", realizationIds: ["ghost-real"], source: "host-retrieval" }]),
      items: [item("item-1")],
      realizations: [realization("real-1", "item-1")],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value[0].realizationIds).toEqual([]);
    expect(result.value[0].availability).toEqual({ available: false, reason: "no-realization" });
  });

  it("expands candidates with no realization preference to all host realizations for the item", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([{ itemId: "item-1", source: "host-retrieval" }]),
      items: [item("item-1")],
      realizations: [realization("real-2", "item-1"), realization("real-1", "item-1")],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value[0].realizationIds).toEqual(["real-1", "real-2"]);
    expect(result.value[0].availability).toEqual({ available: true });
  });
});

describe("W2-001 normalization: ordering", () => {
  it("orders by rankHint desc, then itemId, then source; duplicates merge keeping the max hint", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([
        { itemId: "item-b", source: "src-a", rankHint: 1 },
        { itemId: "item-a", source: "src-b", rankHint: 5 },
        { itemId: "item-a", source: "src-a", rankHint: 5 },
        { itemId: "item-c", source: "src-a" },
        { itemId: "item-a", source: "src-a", rankHint: 9 },
      ]),
      items: [item("item-a"), item("item-b"), item("item-c")],
      realizations: [
        realization("real-a", "item-a"),
        realization("real-b", "item-b"),
        realization("real-c", "item-c"),
      ],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map((c) => `${c.itemId}:${c.source}:${c.rankHint ?? "absent"}`)).toEqual([
      "item-a:src-a:9", // merged from rankHints 5 and 9 — strongest hint wins
      "item-a:src-b:5",
      "item-b:src-a:1",
      "item-c:src-a:absent", // absent hints sort last
    ]);
  });

  it("sorts absent rankHints last and ties by itemId then source (code-unit order)", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([
        { itemId: "item-z", source: "src" },
        { itemId: "item-a", source: "src-b", rankHint: 2 },
        { itemId: "item-a", source: "src-a", rankHint: 2 },
        { itemId: "item-m", source: "src", rankHint: 1 },
      ]),
      items: [item("item-z"), item("item-a"), item("item-m")],
      realizations: [
        realization("real-za", "item-z"),
        realization("real-aa", "item-a"),
        realization("real-ma", "item-m"),
      ],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map((c) => `${c.itemId}|${c.source}|${c.rankHint ?? "absent"}`)).toEqual([
      "item-a|src-a|2",
      "item-a|src-b|2",
      "item-m|src|1",
      "item-z|src|absent",
    ]);
  });
});

describe("W2-001 normalization: honest absence", () => {
  it("marks an item without any matching realization as unavailable with reason no-realization", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([{ itemId: "item-1", source: "host-retrieval" }]),
      items: [item("item-1")],
      realizations: [realization("real-other", "item-2")],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(1);
    expect(result.value[0].availability).toEqual({ available: false, reason: "no-realization" });
    expect(result.value[0].realizationIds).toEqual([]);
  });

  it("marks a candidate with no catalog item as unavailable with reason no-catalog-item", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([{ itemId: "ghost-item", source: "host-retrieval" }]),
      items: [item("item-1")],
      realizations: [realization("real-1", "item-1")],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value[0].availability).toEqual({ available: false, reason: "no-catalog-item" });
    expect(result.value[0].labels).toEqual([]);
  });

  it("never invents realizations, labels or availability — output reflects only input truth", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([{ itemId: "item-1", source: "s" }]),
      items: [item("item-1", ["b-label", "a-label", "b-label"])],
      realizations: [],
      tenant,
    });
    if (!result.ok) throw new Error(result.error.message);
    const record = result.value[0];
    expect(record.realizationIds).toEqual([]);
    expect(record.availability.available).toBe(false);
    expect(record.labels).toEqual(["a-label", "b-label"]); // deduped + sorted, never invented
  });
});

describe("W2-001 normalization: typed errors (never raw throws)", () => {
  it("returns a typed INVALID_INPUT error for empty candidates", () => {
    const result = normalizeCandidates({
      candidates: { setId: "cs-0", candidates: [] },
      items: [],
      realizations: [],
      tenant,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(typeof result.error.message).toBe("string");
    }
  });

  it("returns a typed INVALID_INPUT error for a malformed candidate set", () => {
    const result = normalizeCandidates({
      candidates: { candidates: [{ itemId: "x" }] } as never,
      items: [],
      realizations: [],
      tenant,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("returns a typed INVALID_INPUT error for a malformed tenant", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([{ itemId: "item-1", source: "s" }]),
      items: [item("item-1")],
      realizations: [realization("real-1", "item-1")],
      tenant: {} as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("returns typed issues for malformed catalog items", () => {
    const result = normalizeCandidates({
      candidates: candidateSet([{ itemId: "item-1", source: "s" }]),
      items: [{ itemId: "" } as never],
      realizations: [],
      tenant,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(Array.isArray(result.error.issues)).toBe(true);
    }
  });
});

describe("W2-001 normalization: determinism (digest)", () => {
  const baseInput = {
    candidates: candidateSet([
      { itemId: "item-2", source: "exploration", rankHint: 4 },
      { itemId: "item-1", source: "host-retrieval", rankHint: 2 },
      { itemId: "item-1", source: "host-retrieval", rankHint: 6 },
      { itemId: "item-3", source: "host-retrieval" },
    ]),
    items: [item("item-3"), item("item-1", ["x"]), item("item-2")],
    realizations: [
      realization("real-3", "item-3"),
      realization("real-1b", "item-1"),
      realization("real-1a", "item-1"),
    ],
    tenant,
  };

  it("produces byte-identical outputs (same digest) for identical inputs", () => {
    const a = normalizeCandidates(baseInput);
    const b = normalizeCandidates(baseInput);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(contentDigest(a.value)).toBe(contentDigest(b.value));
  });

  it("is permutation-invariant: shuffled input arrays produce the identical digest", () => {
    const a = normalizeCandidates(baseInput);
    const shuffled = {
      candidates: {
        setId: "cs-1",
        candidates: [...baseInput.candidates.candidates].reverse(),
      },
      items: [...baseInput.items].reverse(),
      realizations: [...baseInput.realizations].reverse(),
      tenant,
    };
    const b = normalizeCandidates(shuffled);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(contentDigest(a.value)).toBe(contentDigest(b.value));
  });
});
