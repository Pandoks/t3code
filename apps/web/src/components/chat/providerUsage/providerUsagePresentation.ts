export const PROVIDER_USAGE_COLORS = {
  codex: "#49A3B0",
  claude: "#D97757",
} as const;

export function orderProviderUsageWindows(
  driver: ProviderDriverKind,
  windows: ReadonlyArray<ProviderUsageWindow>,
): ReadonlyArray<ProviderUsageWindow> {
  if (driver !== "codex") return windows;
  return [...windows].sort((left, right) => codexWindowRank(left) - codexWindowRank(right));
}

export function selectProviderUsageIconLevels(
  driver: ProviderDriverKind,
  windows: ReadonlyArray<ProviderUsageWindow>,
): ReadonlyArray<number> {
  if (driver === "codex") {
    const weekly = windows.find((window) => windowIdentity(window).includes("week"));
    return weekly ? [weekly.remainingPercent] : [];
  }

  const session = windows.find((window) => windowIdentity(window).includes("session"));
  const weekly = windows.find((window) => {
    const identity = windowIdentity(window);
    return identity.includes("week") && !identity.includes("sonnet") && !identity.includes("opus");
  });
  return [session, weekly].flatMap((window) => (window ? [window.remainingPercent] : []));
}

export function formatProviderUsagePercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

export function formatProviderUsageTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000_000_000) return `${trimDecimal(value / 1_000_000_000_000)}T`;
  if (magnitude >= 1_000_000_000) return `${trimDecimal(value / 1_000_000_000)}B`;
  if (magnitude >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (magnitude >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return Math.round(value).toLocaleString("en-US");
}

export function formatProviderUsageCost(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

export function providerUsageBarHeight(value: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || value <= 0 || maximum <= 0) return 0;
  return Math.max(4, Math.min(100, (value / maximum) * 100));
}

export function formatProviderUsageRelativeTime(
  timestamp: string | null | undefined,
  now: Date,
): string {
  if (!timestamp) return "—";
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return "—";
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - time) / 60_000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export function formatProviderUsageReset(timestamp: string | null | undefined, now: Date): string {
  if (!timestamp) return "Reset time unavailable";
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return "Reset time unavailable";
  const remainingMinutes = Math.max(0, Math.ceil((time - now.getTime()) / 60_000));
  if (remainingMinutes === 0) return "Reset due";
  if (remainingMinutes < 60) return `Resets in ${remainingMinutes}m`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours < 24) return `Resets in ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return `Resets in ${days}d${remainderHours > 0 ? ` ${remainderHours}h` : ""}`;
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/u, "");
}

function codexWindowRank(window: ProviderUsageWindow): number {
  const identity = windowIdentity(window);
  if (window.label === "Weekly") return 0;
  if (identity.includes("spark")) return 1;
  if (identity.includes("review")) return 2;
  return 3;
}

function windowIdentity(window: ProviderUsageWindow): string {
  return `${window.id} ${window.label}`.toLowerCase();
}
import type { ProviderDriverKind, ProviderUsageWindow } from "@t3tools/contracts";
