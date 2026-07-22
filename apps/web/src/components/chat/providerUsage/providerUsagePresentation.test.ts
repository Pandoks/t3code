import { describe, expect, it } from "vite-plus/test";

import {
  formatProviderUsageCost,
  formatProviderUsagePercent,
  formatProviderUsageRelativeTime,
  formatProviderUsageTokens,
  providerUsageBarHeight,
} from "./providerUsagePresentation";

describe("provider usage presentation", () => {
  it("formats missing measurements without implying zero usage", () => {
    expect(formatProviderUsagePercent(null)).toBe("—");
    expect(formatProviderUsageTokens(null)).toBe("—");
    expect(formatProviderUsageCost(null)).toBe("—");
    expect(formatProviderUsageRelativeTime(null, new Date("2026-07-22T12:00:00.000Z"))).toBe("—");
  });

  it("formats quota, token, and cost measurements compactly", () => {
    expect(formatProviderUsagePercent(73.6)).toBe("74%");
    expect(formatProviderUsageTokens(1_284)).toBe("1.3K");
    expect(formatProviderUsageTokens(2_640_000)).toBe("2.6M");
    expect(formatProviderUsageTokens(11_061_000_000)).toBe("11.1B");
    expect(formatProviderUsageCost(0)).toBe("$0.00");
    expect(formatProviderUsageCost(12.345)).toBe("$12.35");
  });

  it("gives non-zero days a visible bar while preserving relative scale", () => {
    expect(providerUsageBarHeight(0, 100)).toBe(0);
    expect(providerUsageBarHeight(1, 100)).toBe(4);
    expect(providerUsageBarHeight(25, 100)).toBe(25);
    expect(providerUsageBarHeight(100, 100)).toBe(100);
  });
});
