import { describe, expect, it } from "@effect/vitest";

import { estimateClaudeUsageCostUsd } from "./pricing.ts";

describe("Claude usage pricing", () => {
  it("prices input, cache writes, cache reads, and output independently", () => {
    expect(
      estimateClaudeUsageCostUsd({
        model: "claude-sonnet-4-6",
        inputTokens: 1_000_000,
        cacheCreation5mTokens: 1_000_000,
        cacheCreation1hTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(28.05);
  });

  it("returns null for unrecognized models instead of inventing a price", () => {
    expect(
      estimateClaudeUsageCostUsd({
        model: "custom-model",
        inputTokens: 10,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 10,
      }),
    ).toBeNull();
  });

  it("applies the Sonnet 5 promotional rate only through 2026-08-31", () => {
    const usage = {
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 1_000_000,
    };

    expect(estimateClaudeUsageCostUsd({ ...usage, date: "2026-08-31" })).toBe(12);
    expect(estimateClaudeUsageCostUsd({ ...usage, date: "2026-09-01" })).toBe(18);
    expect(estimateClaudeUsageCostUsd(usage)).toBeNull();
  });
});
