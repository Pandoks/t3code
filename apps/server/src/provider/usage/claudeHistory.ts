import type { ProviderUsageHistory } from "./ProviderUsage.ts";
import { estimateClaudeUsageCostUsd } from "./pricing.ts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MAX_HISTORY_FILE_BYTES = 16 * 1024 * 1024;

export function isClaudeHistoryFileEligible(
  info: { readonly mtimeEpochMillis: number | undefined; readonly sizeBytes: number },
  cutoffEpochMillis: number,
): boolean {
  return (
    info.sizeBytes <= MAX_HISTORY_FILE_BYTES &&
    (info.mtimeEpochMillis === undefined || info.mtimeEpochMillis >= cutoffEpochMillis)
  );
}

export interface ClaudeHistoryRecord {
  readonly id: string;
  readonly date: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly cacheCreation5mTokens: number;
  readonly cacheCreation1hTokens: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseClaudeHistoryLine(line: string): ClaudeHistoryRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const entry = object(parsed);
  const message = object(entry?.message);
  const usage = object(message?.usage);
  const timestamp = entry?.timestamp;
  const model = message?.model;
  if (
    entry?.type !== "assistant" ||
    typeof timestamp !== "string" ||
    typeof model !== "string" ||
    !message ||
    !usage
  ) {
    return null;
  }
  const instant = DateTime.make(timestamp);
  if (Option.isNone(instant)) return null;
  const cacheCreation = object(usage.cache_creation);
  const cacheCreationTotal = finiteNonNegative(usage.cache_creation_input_tokens);
  const cacheCreation5m = finiteNonNegative(cacheCreation?.ephemeral_5m_input_tokens);
  const cacheCreation1h = finiteNonNegative(cacheCreation?.ephemeral_1h_input_tokens);
  const categorizedCacheCreation = cacheCreation5m + cacheCreation1h;

  return {
    id:
      typeof entry.requestId === "string"
        ? entry.requestId
        : typeof message.id === "string"
          ? message.id
          : typeof entry.uuid === "string"
            ? entry.uuid
            : `${timestamp}\0${model}\0${finiteNonNegative(usage.output_tokens)}`,
    date: DateTime.formatIso(instant.value).slice(0, 10),
    model,
    inputTokens: finiteNonNegative(usage.input_tokens),
    cacheCreation5mTokens: categorizedCacheCreation === 0 ? cacheCreationTotal : cacheCreation5m,
    cacheCreation1hTokens: cacheCreation1h,
    cacheReadTokens: finiteNonNegative(usage.cache_read_input_tokens),
    outputTokens: finiteNonNegative(usage.output_tokens),
  };
}

function addDays(date: string, days: number): string {
  return DateTime.makeUnsafe(`${date}T00:00:00.000Z`)
    .pipe(DateTime.add({ days }), DateTime.formatIso)
    .slice(0, 10);
}

export function aggregateClaudeHistory(input: {
  readonly today: string;
  readonly records: Iterable<ClaudeHistoryRecord>;
}): ProviderUsageHistory {
  const cutoff = addDays(input.today, -29);
  const unique = new Map<string, ClaudeHistoryRecord>();
  for (const record of input.records) {
    if (record.date >= cutoff && record.date <= input.today) unique.set(record.id, record);
  }

  const byDate = new Map<
    string,
    {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number | null;
    }
  >();
  const byModel = new Map<string, number>();
  for (const record of unique.values()) {
    const cacheCreationTokens = record.cacheCreation5mTokens + record.cacheCreation1hTokens;
    const totalTokens =
      record.inputTokens + cacheCreationTokens + record.cacheReadTokens + record.outputTokens;
    const estimatedCostUsd = estimateClaudeUsageCostUsd(record);
    const current = byDate.get(record.date) ?? {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: estimatedCostUsd === null ? null : 0,
    };
    current.inputTokens += record.inputTokens + cacheCreationTokens;
    current.cachedInputTokens += record.cacheReadTokens;
    current.outputTokens += record.outputTokens;
    current.totalTokens += totalTokens;
    current.estimatedCostUsd =
      current.estimatedCostUsd === null || estimatedCostUsd === null
        ? null
        : current.estimatedCostUsd + estimatedCostUsd;
    byDate.set(record.date, current);
    byModel.set(record.model, (byModel.get(record.model) ?? 0) + totalTokens);
  }

  const daily = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, point]) => ({ date: `${date}T00:00:00.000Z`, ...point }));
  const todayPoint = daily.find((point) => point.date.slice(0, 10) === input.today);
  const allCostsKnown = daily.every((point) => point.estimatedCostUsd !== null);
  const topModel = [...byModel.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  return {
    todayTokens: todayPoint?.totalTokens ?? 0,
    todayEstimatedCostUsd: todayPoint?.estimatedCostUsd ?? null,
    thirtyDayTokens: daily.reduce((sum, point) => sum + point.totalTokens, 0),
    thirtyDayEstimatedCostUsd: allCostsKnown
      ? daily.reduce((sum, point) => sum + (point.estimatedCostUsd ?? 0), 0)
      : null,
    topModel,
    daily,
  };
}
