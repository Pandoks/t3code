import { describe, expect, it } from "@effect/vitest";

import { aggregateCodexHistory, parseCodexHistoryFile } from "./codexHistory.ts";

describe("Codex local history", () => {
  it("turns cumulative token counters into model-aware deltas", () => {
    const records = parseCodexHistoryFile(
      [
        JSON.stringify({
          timestamp: "2026-07-22T10:00:00.000Z",
          type: "turn_context",
          payload: { model: "gpt-5.6-sol" },
        }),
        JSON.stringify({
          timestamp: "2026-07-22T10:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 1_000,
                cached_input_tokens: 400,
                output_tokens: 100,
                total_tokens: 1_100,
              },
            },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-22T10:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 1_600,
                cached_input_tokens: 700,
                output_tokens: 180,
                total_tokens: 1_780,
              },
            },
          },
        }),
      ].join("\n"),
    );

    expect(records).toEqual([
      {
        date: "2026-07-22",
        model: "gpt-5.6-sol",
        inputTokens: 900,
        cachedInputTokens: 700,
        outputTokens: 180,
        totalTokens: 1_780,
      },
    ]);
  });

  it("backfills counters emitted before the first model context", () => {
    const records = parseCodexHistoryFile(
      [
        JSON.stringify({
          timestamp: "2026-07-22T10:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 20,
                output_tokens: 10,
                total_tokens: 110,
              },
            },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-22T10:01:00.000Z",
          type: "turn_context",
          payload: { model: "gpt-5.6-sol" },
        }),
      ].join("\n"),
    );

    expect(records[0]?.model).toBe("gpt-5.6-sol");
  });

  it("excludes subagent rollouts so parent and child counters are not double-counted", () => {
    const records = parseCodexHistoryFile(
      [
        JSON.stringify({
          timestamp: "2026-07-22T10:00:00.000Z",
          type: "session_meta",
          payload: {
            parent_thread_id: "parent",
            source: { subagent: { other: "guardian" } },
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-22T10:01:00.000Z",
          type: "turn_context",
          payload: { model: "codex-auto-review" },
        }),
        JSON.stringify({
          timestamp: "2026-07-22T10:02:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                output_tokens: 10,
                total_tokens: 110,
              },
            },
          },
        }),
      ].join("\n"),
    );

    expect(records).toEqual([]);
  });

  it("aggregates 30 days, estimates known models, and selects the top model", () => {
    const history = aggregateCodexHistory({
      today: "2026-07-22",
      records: [
        {
          date: "2026-07-22",
          model: "gpt-5.6-sol",
          inputTokens: 900_000,
          cachedInputTokens: 700_000,
          outputTokens: 180_000,
          totalTokens: 1_780_000,
        },
        {
          date: "2026-07-21",
          model: "gpt-5.6-terra",
          inputTokens: 200_000,
          cachedInputTokens: 100_000,
          outputTokens: 50_000,
          totalTokens: 350_000,
        },
      ],
    });

    expect(history.todayTokens).toBe(1_780_000);
    expect(history.thirtyDayTokens).toBe(2_130_000);
    expect(history.todayEstimatedCostUsd).toBeCloseTo(10.25);
    expect(history.thirtyDayEstimatedCostUsd).toBeCloseTo(11.525);
    expect(history.topModel).toBe("gpt-5.6-sol");
    expect(history.daily[1]).toMatchObject({
      inputTokens: 900_000,
      cachedInputTokens: 700_000,
      outputTokens: 180_000,
    });
  });

  it("keeps token totals but makes aggregate cost unavailable for unknown models", () => {
    const history = aggregateCodexHistory({
      today: "2026-07-22",
      records: [
        {
          date: "2026-07-22",
          model: "future-model",
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 10,
          totalTokens: 110,
        },
      ],
    });

    expect(history.todayTokens).toBe(110);
    expect(history.todayEstimatedCostUsd).toBeNull();
    expect(history.thirtyDayEstimatedCostUsd).toBeNull();
  });

  it("keeps a known-model estimate when the same day also has unattributed tokens", () => {
    const history = aggregateCodexHistory({
      today: "2026-07-22",
      records: [
        {
          date: "2026-07-22",
          model: "unknown",
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 10,
          totalTokens: 110,
        },
        {
          date: "2026-07-22",
          model: "gpt-5.6-sol",
          inputTokens: 1_000_000,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 1_000_000,
        },
      ],
    });

    expect(history.todayTokens).toBe(1_000_110);
    expect(history.todayEstimatedCostUsd).toBe(5);
    expect(history.thirtyDayEstimatedCostUsd).toBe(5);
  });
});
