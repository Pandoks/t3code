import type { ProviderUsageWindow } from "./ProviderUsage.ts";
import * as DateTime from "effect/DateTime";

export function normalizeUsagePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function normalizeUsageWindow(input: {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAtEpochSeconds: number;
  readonly windowDurationMinutes: number;
  readonly reservePercent?: number;
}): ProviderUsageWindow {
  const usedPercent = normalizeUsagePercent(input.usedPercent);
  return {
    id: input.id,
    label: input.label,
    usedPercent,
    remainingPercent: normalizeUsagePercent(100 - usedPercent),
    resetsAt: DateTime.formatIso(DateTime.makeUnsafe(input.resetsAtEpochSeconds * 1_000)),
    windowDurationMinutes: input.windowDurationMinutes,
    ...(input.reservePercent === undefined
      ? {}
      : { reservePercent: normalizeUsagePercent(input.reservePercent) }),
  };
}

export function formatUsageWindowDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "Usage limit";
  if (minutes % 10_080 === 0) {
    const weeks = minutes / 10_080;
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}
