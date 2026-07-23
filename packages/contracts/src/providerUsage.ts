import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

const decodeDateTimeUtcFromString = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString);
const IsoDateTimeString = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T/.test(value) && Option.isSome(decodeDateTimeUtcFromString(value)),
    { expected: "an ISO 8601 date-time string" },
  ),
);

export const ProviderUsageWindow = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  usedPercent: Schema.Number,
  remainingPercent: Schema.Number,
  resetsAt: Schema.NullOr(IsoDateTimeString),
  windowDurationMinutes: Schema.Number,
  reservePercent: Schema.optional(Schema.Number),
  unavailable: Schema.optional(Schema.Boolean),
});
export type ProviderUsageWindow = typeof ProviderUsageWindow.Type;

export const ProviderUsageDailyPoint = Schema.Struct({
  date: IsoDateTimeString,
  inputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  estimatedCostUsd: Schema.Union([Schema.Number, Schema.Null]),
});
export type ProviderUsageDailyPoint = typeof ProviderUsageDailyPoint.Type;

export const ProviderUsageHistory = Schema.Struct({
  todayTokens: Schema.Number,
  todayEstimatedCostUsd: Schema.Union([Schema.Number, Schema.Null]),
  thirtyDayTokens: Schema.Number,
  thirtyDayEstimatedCostUsd: Schema.Union([Schema.Number, Schema.Null]),
  topModel: Schema.Union([TrimmedNonEmptyString, Schema.Null]),
  daily: Schema.Array(ProviderUsageDailyPoint),
});
export type ProviderUsageHistory = typeof ProviderUsageHistory.Type;

export const ProviderUsageStatus = Schema.Literals([
  "ready",
  "refreshing",
  "stale",
  "unavailable",
  "error",
]);
export type ProviderUsageStatus = typeof ProviderUsageStatus.Type;

export const ProviderUsageSnapshot = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: Schema.String,
  planLabel: Schema.optional(TrimmedNonEmptyString),
  status: ProviderUsageStatus,
  checkedAt: IsoDateTimeString,
  lastSuccessfulAt: Schema.NullOr(IsoDateTimeString),
  headlineWindowId: Schema.NullOr(Schema.String),
  windows: Schema.Array(ProviderUsageWindow),
  history: Schema.optional(ProviderUsageHistory),
  message: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderUsageSnapshot = typeof ProviderUsageSnapshot.Type;

export const ProviderUsageSnapshotList = Schema.Struct({
  snapshots: Schema.Array(ProviderUsageSnapshot),
});
export type ProviderUsageSnapshotList = typeof ProviderUsageSnapshotList.Type;

export const ProviderUsageRefreshInput = Schema.Struct({
  instanceId: Schema.optional(ProviderInstanceId),
});
export type ProviderUsageRefreshInput = typeof ProviderUsageRefreshInput.Type;
