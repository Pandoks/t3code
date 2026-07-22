import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ProviderUsageRefreshInput,
  ProviderUsageSnapshot,
  ProviderUsageSnapshotList,
} from "./providerUsage.ts";
import {
  WS_METHODS,
  WsProviderUsageRefreshRpc,
  WsRpcGroup,
  WsSubscribeProviderUsageRpc,
} from "./rpc.ts";

const decodeProviderUsageSnapshot = Schema.decodeUnknownSync(ProviderUsageSnapshot);
const decodeProviderUsageSnapshotList = Schema.decodeUnknownSync(ProviderUsageSnapshotList);
const decodeProviderUsageRefreshInput = Schema.decodeUnknownSync(ProviderUsageRefreshInput);

const availableSnapshotInput = {
  instanceId: "codex_personal",
  driver: "codex",
  displayName: "Personal Codex",
  status: "ready",
  checkedAt: "2026-07-22T12:00:00.000Z",
  lastSuccessfulAt: "2026-07-22T11:59:59.000Z",
  headlineWindowId: "five-hour",
  windows: [
    {
      id: "five-hour",
      label: "5-hour limit",
      usedPercent: 42,
      remainingPercent: 58,
      resetsAt: "2026-07-22T15:00:00.000Z",
      windowDurationMinutes: 300,
      reservePercent: 10,
    },
  ],
  history: {
    todayTokens: 1_500_000,
    todayEstimatedCostUsd: 37.25,
    thirtyDayTokens: 12_000_000,
    thirtyDayEstimatedCostUsd: null,
    topModel: "gpt-5.6",
    daily: [
      {
        date: "2026-07-22T00:00:00.000Z",
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        outputTokens: 300_000,
        totalTokens: 1_500_000,
        estimatedCostUsd: null,
      },
    ],
  },
} as const;

describe("ProviderUsageSnapshot", () => {
  it("decodes an available provider's usage windows and history", () => {
    const parsed = decodeProviderUsageSnapshot(availableSnapshotInput);

    expect(parsed.windows[0]?.reservePercent).toBe(10);
    expect(parsed.checkedAt).toBe("2026-07-22T12:00:00.000Z");
    expect(parsed.windows[0]?.resetsAt).toBe("2026-07-22T15:00:00.000Z");
    expect(parsed.history?.daily[0]?.estimatedCostUsd).toBeNull();
    expect(parsed.history?.topModel).toBe("gpt-5.6");
  });

  it("decodes an initial unavailable snapshot without fabricated successful state", () => {
    const parsed = decodeProviderUsageSnapshotList({
      snapshots: [
        {
          instanceId: "claude_work",
          driver: "claudeAgent",
          displayName: "Work Claude",
          status: "unavailable",
          checkedAt: "2026-07-22T12:00:00.000Z",
          lastSuccessfulAt: null,
          headlineWindowId: null,
          windows: [],
          message: "Authentication is required",
        },
      ],
    });

    expect(parsed.snapshots[0]?.history).toBeUndefined();
    expect(parsed.snapshots[0]?.lastSuccessfulAt).toBeNull();
    expect(parsed.snapshots[0]?.headlineWindowId).toBeNull();
    expect(parsed.snapshots[0]?.message).toBe("Authentication is required");
  });

  it("rejects invalid date-time strings across the usage snapshot", () => {
    const invalidInputs = [
      { ...availableSnapshotInput, checkedAt: "not-a-date" },
      { ...availableSnapshotInput, lastSuccessfulAt: "not-a-date" },
      {
        ...availableSnapshotInput,
        windows: [{ ...availableSnapshotInput.windows[0], resetsAt: "not-a-date" }],
      },
      {
        ...availableSnapshotInput,
        history: {
          ...availableSnapshotInput.history,
          daily: [{ ...availableSnapshotInput.history.daily[0], date: "not-a-date" }],
        },
      },
    ];

    for (const input of invalidInputs) {
      expect(() => decodeProviderUsageSnapshot(input)).toThrow();
    }
  });

  it("rejects unrecognized availability states", () => {
    expect(() =>
      decodeProviderUsageSnapshot({
        instanceId: "codex_personal",
        driver: "codex",
        displayName: "Personal Codex",
        status: "pending",
        checkedAt: "2026-07-22T12:00:00.000Z",
        lastSuccessfulAt: "2026-07-22T11:59:59.000Z",
        headlineWindowId: "five-hour",
        windows: [],
      }),
    ).toThrow();
  });
});

describe("provider usage RPC", () => {
  it("exposes refresh and subscription methods through the shared RPC group", () => {
    expect(WS_METHODS.providerUsageRefresh).toBe("providerUsage.refresh");
    expect(WS_METHODS.subscribeProviderUsage).toBe("subscribeProviderUsage");
    expect(WsProviderUsageRefreshRpc._tag).toBe(WS_METHODS.providerUsageRefresh);
    expect(WsSubscribeProviderUsageRpc._tag).toBe(WS_METHODS.subscribeProviderUsage);
    expect(WsRpcGroup.requests.get(WS_METHODS.providerUsageRefresh)).toBe(
      WsProviderUsageRefreshRpc,
    );
    expect(WsRpcGroup.requests.get(WS_METHODS.subscribeProviderUsage)).toBe(
      WsSubscribeProviderUsageRpc,
    );
  });

  it("accepts an optional instance target when refreshing usage", () => {
    expect(decodeProviderUsageRefreshInput({})).toEqual({});
    expect(decodeProviderUsageRefreshInput({ instanceId: "codex_personal" })).toEqual({
      instanceId: "codex_personal",
    });
  });
});
