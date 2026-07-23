import { describe, expect, it } from "@effect/vitest";

import { mergeCodexUsageDrafts, parseCodexOAuthUsage } from "./codexOAuthUsage.ts";

describe("Codex OAuth usage", () => {
  it("normalizes weekly, Spark, and Code review windows", () => {
    const result = parseCodexOAuthUsage({
      rate_limit: {
        secondary_window: {
          used_percent: 54,
          reset_at: 1_785_258_400,
          limit_window_seconds: 604_800,
        },
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 53,
          reset_at: 1_785_258_400,
          limit_window_seconds: 604_800,
        },
      },
      additional_rate_limits: [
        {
          limit_name: "GPT-5.3-Codex-Spark",
          rate_limit: {
            primary_window: {
              used_percent: 0,
              reset_at: 1_785_368_462,
              limit_window_seconds: 604_800,
            },
          },
        },
      ],
    });

    expect(
      result.windows.map(({ id, label, remainingPercent }) => [id, label, remainingPercent]),
    ).toEqual([
      ["weekly", "Weekly", 46],
      ["spark-weekly", "Codex Spark Weekly", 100],
      ["code-review", "Code review", 47],
    ]);
  });

  it("omits a nullable Code review limit", () => {
    const result = parseCodexOAuthUsage({
      rate_limit: {
        secondary_window: {
          used_percent: 54,
          reset_at: 1_785_258_400,
          limit_window_seconds: 604_800,
        },
      },
      code_review_rate_limit: null,
    });

    expect(result.windows.map((window) => window.id)).toEqual(["weekly"]);
  });

  it("enriches app-server windows without duplicating semantic limits", () => {
    const merged = mergeCodexUsageDrafts(
      {
        headlineWindowId: "codex:primary",
        windows: [
          usageWindow("codex:primary", "Weekly", 55),
          usageWindow("codex_bengalfox:primary", "Codex Spark Weekly", 0),
        ],
      },
      {
        headlineWindowId: "weekly",
        windows: [
          usageWindow("weekly", "Weekly", 54),
          usageWindow("spark-weekly", "Codex Spark Weekly", 0),
          usageWindow("code-review", "Code review", 53),
        ],
      },
    );

    expect(merged.windows.map((window) => window.label)).toEqual([
      "Weekly",
      "Codex Spark Weekly",
      "Code review",
    ]);
  });
});

function usageWindow(id: string, label: string, usedPercent: number) {
  return {
    id,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: "2026-07-29T12:00:00.000Z",
    windowDurationMinutes: 10_080,
  };
}
