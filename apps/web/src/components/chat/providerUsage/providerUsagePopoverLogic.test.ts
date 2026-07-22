import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderUsageSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterSupportedProviderUsageSnapshots,
  isProviderUsageDriver,
  reconcileProviderUsageSelectedInstanceId,
  resolveProviderUsageSelectedInstanceId,
  shouldRefreshProviderUsageOnOpen,
} from "./providerUsagePopoverLogic";

const makeSnapshot = (
  instanceId: string,
  driver: string,
  checkedAt = "2026-07-22T12:00:00.000Z",
): ProviderUsageSnapshot => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  displayName: instanceId,
  status: "ready",
  checkedAt,
  lastSuccessfulAt: checkedAt,
  headlineWindowId: null,
  windows: [],
});

describe("provider usage popover logic", () => {
  it("supports Codex and Claude Agent chats only", () => {
    expect(isProviderUsageDriver(ProviderDriverKind.make("codex"))).toBe(true);
    expect(isProviderUsageDriver(ProviderDriverKind.make("claudeAgent"))).toBe(true);
    expect(isProviderUsageDriver(ProviderDriverKind.make("opencode"))).toBe(false);
  });

  it("filters unsupported provider snapshots from tabs", () => {
    const snapshots = [
      makeSnapshot("codex-work", "codex"),
      makeSnapshot("claude-work", "claudeAgent"),
      makeSnapshot("open-code", "opencode"),
    ];

    expect(filterSupportedProviderUsageSnapshots(snapshots).map((item) => item.instanceId)).toEqual(
      ["codex-work", "claude-work"],
    );
  });

  it("selects the current chat provider before falling back to the first snapshot", () => {
    const snapshots = [
      makeSnapshot("codex-personal", "codex"),
      makeSnapshot("codex-work", "codex"),
    ];

    expect(
      resolveProviderUsageSelectedInstanceId({
        snapshots,
        selectedInstanceId: null,
        activeInstanceId: ProviderInstanceId.make("codex-work"),
      }),
    ).toBe("codex-work");
    expect(
      resolveProviderUsageSelectedInstanceId({
        snapshots,
        selectedInstanceId: null,
        activeInstanceId: ProviderInstanceId.make("missing"),
      }),
    ).toBe("codex-personal");
  });

  it("resets the inspected instance when the active chat provider changes", () => {
    expect(
      reconcileProviderUsageSelectedInstanceId({
        selectedInstanceId: ProviderInstanceId.make("codex-personal"),
        previousActiveInstanceId: ProviderInstanceId.make("codex-work"),
        activeInstanceId: ProviderInstanceId.make("claude-work"),
      }),
    ).toBe("claude-work");
    expect(
      reconcileProviderUsageSelectedInstanceId({
        selectedInstanceId: ProviderInstanceId.make("codex-personal"),
        previousActiveInstanceId: ProviderInstanceId.make("codex-work"),
        activeInstanceId: ProviderInstanceId.make("codex-work"),
      }),
    ).toBe("codex-personal");
  });

  it("refreshes on open only when the selected snapshot is older than 60 seconds", () => {
    const now = new Date("2026-07-22T12:01:01.000Z");

    expect(shouldRefreshProviderUsageOnOpen(makeSnapshot("codex", "codex"), now)).toBe(true);
    expect(
      shouldRefreshProviderUsageOnOpen(
        makeSnapshot("codex", "codex", "2026-07-22T12:00:01.000Z"),
        now,
      ),
    ).toBe(false);
  });

  it("refreshes non-ready failure states even when their latest check is fresh", () => {
    const now = new Date("2026-07-22T12:01:00.000Z");
    const fresh = makeSnapshot("codex", "codex", "2026-07-22T12:00:30.000Z");

    expect(shouldRefreshProviderUsageOnOpen({ ...fresh, status: "stale" }, now)).toBe(true);
    expect(shouldRefreshProviderUsageOnOpen({ ...fresh, status: "error" }, now)).toBe(true);
    expect(shouldRefreshProviderUsageOnOpen({ ...fresh, status: "unavailable" }, now)).toBe(true);
    expect(shouldRefreshProviderUsageOnOpen({ ...fresh, status: "refreshing" }, now)).toBe(false);
  });

  it("ages ready data from its last success and falls back to checkedAt without one", () => {
    const now = new Date("2026-07-22T12:02:00.000Z");
    const freshlyChecked = makeSnapshot("codex", "codex", "2026-07-22T12:01:45.000Z");

    expect(
      shouldRefreshProviderUsageOnOpen(
        { ...freshlyChecked, lastSuccessfulAt: "2026-07-22T12:00:00.000Z" },
        now,
      ),
    ).toBe(true);
    expect(
      shouldRefreshProviderUsageOnOpen(
        { ...freshlyChecked, lastSuccessfulAt: "2026-07-22T12:01:30.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      shouldRefreshProviderUsageOnOpen(
        {
          ...freshlyChecked,
          checkedAt: "2026-07-22T12:00:00.000Z",
          lastSuccessfulAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      shouldRefreshProviderUsageOnOpen({ ...freshlyChecked, lastSuccessfulAt: null }, now),
    ).toBe(false);
  });
});
