import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  aggregateClaudeHistory,
  isClaudeHistoryFileEligible,
  parseClaudeHistoryLine,
} from "./claudeHistory.ts";

describe("Claude local history", () => {
  it("accepts assistant usage records and ignores malformed or unrelated lines", () => {
    expect(parseClaudeHistoryLine("not json")).toBeNull();
    expect(
      parseClaudeHistoryLine(JSON.stringify({ type: "user", timestamp: "2025-12-17" })),
    ).toBeNull();
    expect(
      parseClaudeHistoryLine(
        JSON.stringify({
          type: "assistant",
          uuid: "message-1",
          timestamp: "2025-12-17T12:00:00.000Z",
          message: {
            model: "claude-sonnet-4-6",
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 30,
              output_tokens: 40,
              cache_creation: {
                ephemeral_5m_input_tokens: 5,
                ephemeral_1h_input_tokens: 15,
              },
            },
          },
        }),
      ),
    ).toMatchObject({ id: "message-1", date: "2025-12-17", inputTokens: 10, outputTokens: 40 });
  });

  it("prefers request id, then message id, then uuid for progressive-record dedupe", () => {
    const base = {
      type: "assistant",
      uuid: "uuid-1",
      timestamp: "2025-12-17T12:00:00.000Z",
      message: {
        id: "message-1",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    };

    expect(parseClaudeHistoryLine(JSON.stringify({ ...base, requestId: "request-1" }))?.id).toBe(
      "request-1",
    );
    expect(parseClaudeHistoryLine(JSON.stringify(base))?.id).toBe("message-1");
    expect(
      parseClaudeHistoryLine(JSON.stringify({ ...base, message: { ...base.message, id: 42 } }))?.id,
    ).toBe("uuid-1");
  });

  it("deduplicates progressive records by message id and aggregates the trailing 30 days", () => {
    const history = aggregateClaudeHistory({
      today: "2025-12-17",
      records: [
        {
          id: "same-message",
          date: "2025-12-17",
          model: "claude-sonnet-4-6",
          inputTokens: 10,
          cacheCreation5mTokens: 20,
          cacheCreation1hTokens: 0,
          cacheReadTokens: 30,
          outputTokens: 4,
        },
        {
          id: "same-message",
          date: "2025-12-17",
          model: "claude-sonnet-4-6",
          inputTokens: 10,
          cacheCreation5mTokens: 20,
          cacheCreation1hTokens: 0,
          cacheReadTokens: 30,
          outputTokens: 8,
        },
        {
          id: "old-message",
          date: "2025-11-01",
          model: "claude-opus-4-6",
          inputTokens: 100,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 100,
        },
      ],
    });

    expect(history.todayTokens).toBe(68);
    expect(history.thirtyDayTokens).toBe(68);
    expect(history.topModel).toBe("claude-sonnet-4-6");
    expect(history.daily).toHaveLength(1);
    expect(history.daily[0]).toMatchObject({
      date: "2025-12-17T00:00:00.000Z",
      inputTokens: 30,
      cachedInputTokens: 30,
      outputTokens: 8,
      totalTokens: 68,
    });
  });

  it("skips old and oversized history files before reading them", () => {
    const cutoff = DateTime.toEpochMillis(DateTime.makeUnsafe("2025-11-18T00:00:00.000Z"));

    expect(
      isClaudeHistoryFileEligible(
        {
          mtimeEpochMillis: DateTime.toEpochMillis(DateTime.makeUnsafe("2025-11-17T23:59:59.000Z")),
          sizeBytes: 1_000,
        },
        cutoff,
      ),
    ).toBe(false);
    expect(
      isClaudeHistoryFileEligible(
        {
          mtimeEpochMillis: DateTime.toEpochMillis(DateTime.makeUnsafe("2025-12-17T00:00:00.000Z")),
          sizeBytes: 20 * 1024 * 1024,
        },
        cutoff,
      ),
    ).toBe(false);
    expect(
      isClaudeHistoryFileEligible(
        {
          mtimeEpochMillis: DateTime.toEpochMillis(DateTime.makeUnsafe("2025-12-17T00:00:00.000Z")),
          sizeBytes: 1_000,
        },
        cutoff,
      ),
    ).toBe(true);
  });
});
