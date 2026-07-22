import { describe, expect, it } from "@effect/vitest";

import { normalizeUsagePercent, normalizeUsageWindow } from "./normalize.ts";

describe("provider usage normalization", () => {
  it("clamps non-finite and out-of-range percentages", () => {
    expect(normalizeUsagePercent(Number.NaN)).toBe(0);
    expect(normalizeUsagePercent(-4)).toBe(0);
    expect(normalizeUsagePercent(130)).toBe(100);
  });

  it("normalizes a provider window and converts epoch seconds to ISO", () => {
    expect(
      normalizeUsageWindow({
        id: "primary",
        label: "5 hours",
        usedPercent: 37.25,
        resetsAtEpochSeconds: 1_766_000_000,
        windowDurationMinutes: 300,
      }),
    ).toEqual({
      id: "primary",
      label: "5 hours",
      usedPercent: 37.25,
      remainingPercent: 62.75,
      resetsAt: "2025-12-17T19:33:20.000Z",
      windowDurationMinutes: 300,
    });
  });
});
