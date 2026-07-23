import type * as CodexSchema from "effect-codex-app-server/schema";

import type { ProviderUsageSnapshotDraft } from "./ProviderUsage.ts";
import { formatUsageWindowDuration, normalizeUsageWindow } from "./normalize.ts";

type RateLimitResponse = Pick<
  CodexSchema.V2GetAccountRateLimitsResponse,
  "rateLimits" | "rateLimitsByLimitId"
>;
type TokenUsageResponse = CodexSchema.V2GetAccountTokenUsageResponse;

export function parseCodexUsageResponses(input: {
  readonly rateLimits: RateLimitResponse;
  readonly usage?: TokenUsageResponse;
  readonly today: string;
}): ProviderUsageSnapshotDraft {
  const buckets = Object.entries(input.rateLimits.rateLimitsByLimitId ?? {});
  const sourceBuckets =
    buckets.length > 0
      ? buckets
      : [[input.rateLimits.rateLimits.limitId ?? "codex", input.rateLimits.rateLimits] as const];
  const useBucketLabels = buckets.length > 0;
  const windows = sourceBuckets
    .flatMap(([bucketId, bucket]) =>
      [["primary", bucket.primary] as const, ["secondary", bucket.secondary] as const].flatMap(
        ([windowId, window]) => {
          if (
            window?.resetsAt === undefined ||
            window.resetsAt === null ||
            window.windowDurationMins === undefined ||
            window.windowDurationMins === null
          ) {
            return [];
          }
          const durationLabel = formatUsageWindowDuration(window.windowDurationMins);
          const bucketLabel = bucket.limitName?.trim() || bucket.limitId?.trim() || bucketId;
          const identity = `${bucketId} ${bucketLabel}`.toLowerCase();
          const label = identity.includes("review")
            ? "Code review"
            : identity.includes("spark") && window.windowDurationMins >= 10_080
              ? "Codex Spark Weekly"
              : identity.includes("codex") && window.windowDurationMins >= 10_080
                ? "Weekly"
                : useBucketLabels
                  ? `${bucketLabel} · ${durationLabel}`
                  : durationLabel;
          return [
            normalizeUsageWindow({
              id: useBucketLabels ? `${bucketId}:${windowId}` : windowId,
              label,
              usedPercent: window.usedPercent,
              resetsAtEpochSeconds: window.resetsAt,
              windowDurationMinutes: window.windowDurationMins,
            }),
          ];
        },
      ),
    )
    .sort((left, right) => codexWindowOrder(left) - codexWindowOrder(right));
  const headlineWindow = [...windows].sort(
    (left, right) => left.windowDurationMinutes - right.windowDurationMinutes,
  )[0];

  const daily = (input.usage?.dailyUsageBuckets ?? []).map((bucket) => ({
    date: `${bucket.startDate}T00:00:00.000Z`,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: bucket.tokens,
    estimatedCostUsd: null,
  }));

  return {
    headlineWindowId: headlineWindow?.id ?? null,
    windows,
    ...(input.usage
      ? {
          history: {
            todayTokens:
              daily.find((point) => point.date.slice(0, 10) === input.today)?.totalTokens ?? 0,
            todayEstimatedCostUsd: null,
            thirtyDayTokens: daily.reduce((sum, point) => sum + point.totalTokens, 0),
            thirtyDayEstimatedCostUsd: null,
            topModel: null,
            daily,
          },
        }
      : {}),
  };
}

function codexWindowOrder(window: { readonly id: string; readonly label: string }): number {
  const identity = `${window.id} ${window.label}`.toLowerCase();
  if (window.label === "Weekly") return 0;
  if (identity.includes("spark")) return 1;
  if (identity.includes("review")) return 2;
  return 3;
}
