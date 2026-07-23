import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import type { ProviderUsageHistory } from "./ProviderUsage.ts";
import { estimateCodexUsageCostUsd } from "./pricing.ts";

export interface CodexHistoryRecord {
  readonly date: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

type Counters = {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
  readonly total: number;
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function counter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseCodexHistoryFile(contents: string): ReadonlyArray<CodexHistoryRecord> {
  const entries = contents.split("\n").flatMap((line) => {
    try {
      const entry = object(JSON.parse(line));
      return entry ? [entry] : [];
    } catch {
      return [];
    }
  });
  const sessionMetadata = entries.find((entry) => entry.type === "session_meta");
  const sessionPayload = object(sessionMetadata?.payload);
  if (
    typeof sessionPayload?.parent_thread_id === "string" ||
    object(object(sessionPayload?.source)?.subagent)
  ) {
    return [];
  }
  const firstModel =
    entries
      .filter((entry) => entry.type === "turn_context")
      .map((entry) => object(entry.payload)?.model)
      .find((value): value is string => typeof value === "string") ?? "unknown";
  let model = firstModel;
  let previous: Counters = { input: 0, cached: 0, output: 0, total: 0 };
  const aggregated = new Map<string, CodexHistoryRecord>();

  for (const entry of entries) {
    const payload = object(entry?.payload);
    if (entry?.type === "turn_context" && typeof payload?.model === "string") {
      model = payload.model;
      continue;
    }
    if (entry?.type !== "event_msg" || payload?.type !== "token_count") continue;
    const usage = object(object(object(payload.info)?.total_token_usage));
    if (!usage || typeof entry.timestamp !== "string") continue;
    const instant = DateTime.make(entry.timestamp);
    if (Option.isNone(instant)) continue;

    const current: Counters = {
      input: counter(usage.input_tokens),
      cached: counter(usage.cached_input_tokens),
      output: counter(usage.output_tokens),
      total: counter(usage.total_tokens),
    };
    const delta = {
      input: current.input >= previous.input ? current.input - previous.input : current.input,
      cached: current.cached >= previous.cached ? current.cached - previous.cached : current.cached,
      output: current.output >= previous.output ? current.output - previous.output : current.output,
      total: current.total >= previous.total ? current.total - previous.total : current.total,
    };
    previous = current;
    if (delta.total === 0) continue;

    const date = DateTime.formatIso(instant.value).slice(0, 10);
    const key = `${date}\0${model}`;
    const existing = aggregated.get(key);
    const cachedInputTokens = Math.min(delta.cached, delta.input);
    const inputTokens = Math.max(0, delta.input - cachedInputTokens);
    aggregated.set(key, {
      date,
      model,
      inputTokens: (existing?.inputTokens ?? 0) + inputTokens,
      cachedInputTokens: (existing?.cachedInputTokens ?? 0) + cachedInputTokens,
      outputTokens: (existing?.outputTokens ?? 0) + delta.output,
      totalTokens: (existing?.totalTokens ?? 0) + delta.total,
    });
  }
  return [...aggregated.values()];
}

function addDays(date: string, days: number): string {
  return DateTime.makeUnsafe(`${date}T00:00:00.000Z`)
    .pipe(DateTime.add({ days }), DateTime.formatIso)
    .slice(0, 10);
}

export function aggregateCodexHistory(input: {
  readonly today: string;
  readonly records: Iterable<CodexHistoryRecord>;
}): ProviderUsageHistory {
  const cutoff = addDays(input.today, -29);
  const byDate = new Map<
    string,
    {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      hasKnownCost: boolean;
    }
  >();
  const byModel = new Map<string, number>();

  for (const record of input.records) {
    if (record.date < cutoff || record.date > input.today) continue;
    const estimatedCostUsd = estimateCodexUsageCostUsd(record);
    const point = byDate.get(record.date) ?? {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      hasKnownCost: false,
    };
    point.inputTokens += record.inputTokens;
    point.cachedInputTokens += record.cachedInputTokens;
    point.outputTokens += record.outputTokens;
    point.totalTokens += record.totalTokens;
    if (estimatedCostUsd !== null) {
      point.estimatedCostUsd += estimatedCostUsd;
      point.hasKnownCost = true;
    }
    byDate.set(record.date, point);
    byModel.set(record.model, (byModel.get(record.model) ?? 0) + record.totalTokens);
  }

  const daily = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, point]) => ({
      date: `${date}T00:00:00.000Z`,
      inputTokens: point.inputTokens,
      cachedInputTokens: point.cachedInputTokens,
      outputTokens: point.outputTokens,
      totalTokens: point.totalTokens,
      estimatedCostUsd: point.hasKnownCost ? point.estimatedCostUsd : null,
    }));
  const todayPoint = daily.find((point) => point.date.startsWith(input.today));
  const allCostsKnown = daily.length > 0 && daily.every((point) => point.estimatedCostUsd !== null);
  return {
    todayTokens: todayPoint?.totalTokens ?? 0,
    todayEstimatedCostUsd: todayPoint?.estimatedCostUsd ?? null,
    thirtyDayTokens: daily.reduce((sum, point) => sum + point.totalTokens, 0),
    thirtyDayEstimatedCostUsd: allCostsKnown
      ? daily.reduce((sum, point) => sum + (point.estimatedCostUsd ?? 0), 0)
      : null,
    topModel: [...byModel.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
    daily,
  };
}
