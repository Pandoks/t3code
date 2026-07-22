import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ProviderUsageDashboard,
  type ProviderUsageDashboardSnapshot,
} from "./ProviderUsageDashboard";

const snapshot = (overrides: Partial<ProviderUsageDashboardSnapshot> = {}) =>
  ({
    instanceId: ProviderInstanceId.make("codex-default"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    status: "ready" as const,
    checkedAt: "2026-07-22T12:00:00.000Z",
    lastSuccessfulAt: "2026-07-22T12:00:00.000Z",
    headlineWindowId: "session",
    windows: [
      {
        id: "session",
        label: "Session",
        usedPercent: 26,
        remainingPercent: 74,
        resetsAt: "2026-07-22T14:30:00.000Z",
        windowDurationMinutes: 300,
      },
      {
        id: "weekly",
        label: "Weekly",
        usedPercent: 38,
        remainingPercent: 62,
        resetsAt: "2026-07-27T00:00:00.000Z",
        windowDurationMinutes: 10_080,
        reservePercent: 10,
      },
    ],
    history: {
      todayTokens: 12_800,
      todayEstimatedCostUsd: 1.42,
      thirtyDayTokens: 240_000,
      thirtyDayEstimatedCostUsd: 18.75,
      topModel: "gpt-5.4",
      daily: [
        {
          date: "2026-07-21T00:00:00.000Z",
          inputTokens: 80,
          cachedInputTokens: 10,
          outputTokens: 10,
          totalTokens: 100,
          estimatedCostUsd: 0.5,
        },
        {
          date: "2026-07-22T00:00:00.000Z",
          inputTokens: 160,
          cachedInputTokens: 20,
          outputTokens: 20,
          totalTokens: 200,
          estimatedCostUsd: 1,
        },
      ],
    },
    ...overrides,
  }) satisfies ProviderUsageDashboardSnapshot;

describe("ProviderUsageDashboard", () => {
  it("renders provider tabs, headline quota, usage windows, history, and native chart color", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageDashboard
        snapshots={[
          snapshot(),
          snapshot({
            instanceId: ProviderInstanceId.make("claude-work"),
            driver: ProviderDriverKind.make("claudeAgent"),
            displayName: "Claude Work",
          }),
        ]}
        selectedInstanceId={ProviderInstanceId.make("codex-default")}
        now={new Date("2026-07-22T12:05:00.000Z")}
        onSelectInstance={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(markup).toContain("Codex");
    expect(markup).toContain("Claude Work");
    expect(markup).toContain("74%");
    expect(markup).toContain("remaining");
    expect(markup).toContain("Session");
    expect(markup).toContain("Weekly");
    expect(markup).toContain("Today");
    expect(markup).toContain("30 days");
    expect(markup).toContain("gpt-5.4");
    expect(markup).toContain("#49A3B0");
    expect(markup).toContain("Refresh Codex usage");
    expect(markup).toContain('role="tablist" aria-label="Provider usage accounts"');
    const tabId = markup.match(/role="tab"[^>]*id="([^"]+)"[^>]*aria-controls=/)?.[1];
    const panelId = markup.match(/aria-controls="([^"]+)"/)?.[1];
    expect(tabId).toBeTruthy();
    expect(panelId).toBeTruthy();
    expect(markup).toContain(`role="tabpanel" id="${panelId}" aria-labelledby="${tabId}"`);
  });

  it("uses Claude's native accent for Claude Agent instances", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageDashboard
        snapshots={[
          snapshot({
            instanceId: ProviderInstanceId.make("claude-work"),
            driver: ProviderDriverKind.make("claudeAgent"),
            displayName: "Claude Work",
          }),
        ]}
        selectedInstanceId={ProviderInstanceId.make("claude-work")}
        now={new Date("2026-07-22T12:05:00.000Z")}
        onSelectInstance={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(markup).toContain("#D97757");
  });

  it("reports freshness from the last successful usage snapshot", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageDashboard
        snapshots={[
          snapshot({
            status: "stale",
            checkedAt: "2026-07-22T12:04:00.000Z",
            lastSuccessfulAt: "2026-07-22T10:00:00.000Z",
          }),
        ]}
        selectedInstanceId={ProviderInstanceId.make("codex-default")}
        now={new Date("2026-07-22T12:05:00.000Z")}
        onSelectInstance={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(markup).toContain("Updated 2h ago");
    expect(markup).not.toContain("Checked 1m ago");
  });

  it("uses an em dash for missing values and keeps a provider message visible", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageDashboard
        snapshots={[
          snapshot({
            status: "unavailable",
            lastSuccessfulAt: null,
            headlineWindowId: null,
            windows: [],
            history: undefined,
            message: "Usage is not available for this account.",
          }),
        ]}
        selectedInstanceId={ProviderInstanceId.make("codex-default")}
        now={new Date("2026-07-22T12:05:00.000Z")}
        onSelectInstance={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(markup).toContain("Usage is not available for this account.");
    expect(markup).toContain("Usage unavailable");
    expect(markup).toContain("—");
  });
});
