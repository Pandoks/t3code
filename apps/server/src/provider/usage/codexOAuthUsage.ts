import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import type { ProviderUsageSnapshotDraft, ProviderUsageWindow } from "./ProviderUsage.ts";
import { normalizeUsageWindow } from "./normalize.ts";

const decodeJson = Schema.decodeEffect(Schema.UnknownFromJsonString);

export class CodexOAuthUsageError extends Schema.TaggedErrorClass<CodexOAuthUsageError>()(
  "CodexOAuthUsageError",
  { cause: Schema.Defect() },
) {}

export function parseCodexOAuthUsage(payload: unknown): ProviderUsageSnapshotDraft {
  const root = asRecord(payload);
  const windows: ProviderUsageWindow[] = [];
  const main = asRecord(root.rate_limit);
  appendMainWindow(windows, main.primary_window, "primary");
  appendMainWindow(windows, main.secondary_window, "secondary");
  if (Array.isArray(root.additional_rate_limits)) {
    for (const value of root.additional_rate_limits) {
      const limit = asRecord(value);
      const name = typeof limit.limit_name === "string" ? limit.limit_name : "Additional limit";
      const rateLimit = asRecord(limit.rate_limit);
      const durationMinutes = duration(asRecord(rateLimit.primary_window));
      appendRateWindow(
        windows,
        rateLimit.primary_window,
        name.toLowerCase().includes("spark") ? "spark-weekly" : `additional-${slug(name)}`,
        name.toLowerCase().includes("spark") && durationMinutes === 10_080
          ? "Codex Spark Weekly"
          : name,
      );
    }
  }
  const codeReviewWindow = asRecord(root.code_review_rate_limit).primary_window;
  if (Object.keys(asRecord(codeReviewWindow)).length > 0) {
    appendRateWindow(windows, codeReviewWindow, "code-review", "Code review");
  } else {
    windows.push({
      id: "code-review",
      label: "Code review",
      usedPercent: 0,
      remainingPercent: 0,
      resetsAt: null,
      windowDurationMinutes: 0,
      unavailable: true,
    });
  }
  const deduplicated = deduplicate(windows);
  const planType = typeof root.plan_type === "string" ? root.plan_type.trim() : "";
  return {
    ...(planType ? { planLabel: titleCase(planType) } : {}),
    headlineWindowId: deduplicated[0]?.id ?? null,
    windows: deduplicated,
  };
}

function appendMainWindow(
  windows: ProviderUsageWindow[],
  value: unknown,
  fallbackId: string,
): void {
  const minutes = duration(asRecord(value));
  const id = minutes === 300 ? "session" : minutes === 10_080 ? "weekly" : fallbackId;
  const label = minutes === 300 ? "Session" : minutes === 10_080 ? "Weekly" : "Usage limit";
  appendRateWindow(windows, value, id, label);
}

export function mergeCodexUsageDrafts(
  base: ProviderUsageSnapshotDraft,
  enrichment: ProviderUsageSnapshotDraft,
): ProviderUsageSnapshotDraft {
  const enrichmentLabels = new Set(enrichment.windows.map((window) => window.label.toLowerCase()));
  return {
    ...base,
    ...(enrichment.planLabel ? { planLabel: enrichment.planLabel } : {}),
    headlineWindowId: enrichment.headlineWindowId ?? base.headlineWindowId,
    windows: [
      ...enrichment.windows,
      ...base.windows.filter((window) => !enrichmentLabels.has(window.label.toLowerCase())),
    ],
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function makeCodexOAuthUsageSource(input: {
  readonly authPath: string;
}): Effect.Effect<
  ProviderUsageSnapshotDraft,
  CodexOAuthUsageError,
  FileSystem.FileSystem | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const client = yield* HttpClient.HttpClient;
    const rawAuth = yield* fileSystem
      .readFileString(input.authPath)
      .pipe(Effect.mapError((cause) => new CodexOAuthUsageError({ cause })));
    const auth = asRecord(
      yield* decodeJson(rawAuth).pipe(
        Effect.mapError((cause) => new CodexOAuthUsageError({ cause })),
      ),
    );
    const tokens = asRecord(auth.tokens);
    const accessToken = tokens.access_token ?? auth.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return yield* new CodexOAuthUsageError({
        cause: "credentials unavailable",
      });
    }
    const request = HttpClientRequest.get("https://chatgpt.com/backend-api/wham/usage").pipe(
      HttpClientRequest.bearerToken(accessToken),
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    const response = yield* client.execute(request).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) => new CodexOAuthUsageError({ cause })),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new CodexOAuthUsageError({
        cause: `HTTP ${response.status}`,
      });
    }
    const payload = yield* response.json.pipe(
      Effect.mapError((cause) => new CodexOAuthUsageError({ cause })),
    );
    return parseCodexOAuthUsage(payload);
  });
}

function appendRateWindow(
  windows: ProviderUsageWindow[],
  value: unknown,
  id: string,
  label: string,
): void {
  const record = asRecord(value);
  const usedPercent = numberValue(record.used_percent);
  const resetsAt = numberValue(record.reset_at);
  const windowDurationMinutes = duration(record);
  if (usedPercent === null || resetsAt === null || windowDurationMinutes === null) return;
  windows.push(
    normalizeUsageWindow({
      id,
      label,
      usedPercent,
      resetsAtEpochSeconds: resetsAt,
      windowDurationMinutes,
    }),
  );
}

function duration(record: Record<string, unknown>): number | null {
  const seconds = numberValue(record.limit_window_seconds);
  return seconds === null ? null : seconds / 60;
}

function deduplicate(
  windows: ReadonlyArray<ProviderUsageWindow>,
): ReadonlyArray<ProviderUsageWindow> {
  const seen = new Set<string>();
  return windows.filter((window) => {
    if (seen.has(window.id)) return false;
    seen.add(window.id);
    return true;
  });
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}
