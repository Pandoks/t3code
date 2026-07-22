import { describe, expect, it } from "@effect/vitest";

import { parseCodexUsageResponses } from "./codexUsage.ts";

describe("Codex account usage", () => {
  it("maps rate-limit windows and daily token history without account metadata", () => {
    const result = parseCodexUsageResponses({
      rateLimits: {
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          primary: { usedPercent: 18, resetsAt: 1_766_000_000, windowDurationMins: 300 },
          secondary: { usedPercent: 62, resetsAt: 1_766_500_000, windowDurationMins: 10_080 },
        },
      },
      usage: {
        summary: { lifetimeTokens: 10_000 },
        dailyUsageBuckets: [
          { startDate: "2025-12-16", tokens: 400 },
          { startDate: "2025-12-17", tokens: 600 },
        ],
      },
      today: "2025-12-17",
    });

    expect(result.headlineWindowId).toBe("primary");
    expect(
      result.windows.map((window) => [window.id, window.label, window.remainingPercent]),
    ).toEqual([
      ["primary", "5 hours", 82],
      ["secondary", "1 week", 38],
    ]);
    expect(result.history).toEqual({
      todayTokens: 600,
      todayEstimatedCostUsd: null,
      thirtyDayTokens: 1_000,
      thirtyDayEstimatedCostUsd: null,
      topModel: null,
      daily: [
        {
          date: "2025-12-16T00:00:00.000Z",
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 400,
          estimatedCostUsd: null,
        },
        {
          date: "2025-12-17T00:00:00.000Z",
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 600,
          estimatedCostUsd: null,
        },
      ],
    });
  });

  it("uses named multi-limit buckets, deduplicates the legacy mirror, and headlines the shortest window", () => {
    const result = parseCodexUsageResponses({
      rateLimits: {
        rateLimits: {
          primary: { usedPercent: 12, resetsAt: 1_766_000_000, windowDurationMins: 300 },
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 12, resetsAt: 1_766_000_000, windowDurationMins: 300 },
            secondary: {
              usedPercent: 41,
              resetsAt: 1_766_500_000,
              windowDurationMins: 10_080,
            },
          },
          review: {
            limitId: "review",
            limitName: "Code review",
            primary: { usedPercent: 7, resetsAt: 1_766_100_000, windowDurationMins: 1_440 },
          },
        },
      },
      usage: { summary: {}, dailyUsageBuckets: [] },
      today: "2025-12-17",
    });

    expect(result.windows.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "codex:primary", label: "Codex · 5 hours" },
      { id: "codex:secondary", label: "Codex · 1 week" },
      { id: "review:primary", label: "Code review · 1 day" },
    ]);
    expect(result.headlineWindowId).toBe("codex:primary");
  });

  it("retains distinct limit identities that currently have identical window statistics", () => {
    const sharedWindow = {
      usedPercent: 12,
      resetsAt: 1_766_000_000,
      windowDurationMins: 300,
    };
    const result = parseCodexUsageResponses({
      rateLimits: {
        rateLimits: { primary: sharedWindow },
        rateLimitsByLimitId: {
          codex: { limitId: "codex", limitName: "Codex", primary: sharedWindow },
          review: { limitId: "review", limitName: "Code review", primary: sharedWindow },
        },
      },
      usage: { summary: {}, dailyUsageBuckets: [] },
      today: "2025-12-17",
    });

    expect(result.windows.map((window) => window.id)).toEqual(["codex:primary", "review:primary"]);
  });
});
