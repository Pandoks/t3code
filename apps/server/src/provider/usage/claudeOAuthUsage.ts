import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import type { ProviderUsageSnapshotDraft, ProviderUsageWindow } from "./ProviderUsage.ts";
import { normalizeUsageWindow } from "./normalize.ts";

const WEEKLY_MINUTES = 10_080;
const decodeJson = Schema.decodeEffect(Schema.UnknownFromJsonString);

export class ClaudeOAuthUsageError extends Schema.TaggedErrorClass<ClaudeOAuthUsageError>()(
  "ClaudeOAuthUsageError",
  { cause: Schema.Defect() },
) {}

const isClaudeOAuthUsageError = Schema.is(ClaudeOAuthUsageError);

export function parseClaudeOAuthUsage(payload: unknown): ProviderUsageSnapshotDraft {
  const root = asRecord(payload);
  const windows: ProviderUsageWindow[] = [];
  appendWindow(windows, root.five_hour, "session", "Session", 300);
  appendWindow(windows, root.seven_day, "weekly", "Weekly", WEEKLY_MINUTES);
  for (const key of [
    "seven_day_routines",
    "seven_day_claude_routines",
    "claude_routines",
    "routines",
  ]) {
    if (!Object.hasOwn(root, key)) continue;
    appendWindow(windows, root[key], "routines", "Daily Routines", WEEKLY_MINUTES);
    break;
  }
  if (Array.isArray(root.limits)) {
    for (const value of root.limits) {
      const limit = asRecord(value);
      if (limit.kind !== "weekly_scoped") continue;
      const model = asRecord(asRecord(limit.scope).model);
      const name = typeof model.display_name === "string" ? model.display_name.trim() : "";
      if (!name) continue;
      appendWindow(
        windows,
        { utilization: limit.percent, resets_at: limit.resets_at },
        `weekly-${slug(name)}`,
        `${name} only`,
        WEEKLY_MINUTES,
      );
    }
  }
  return {
    headlineWindowId:
      windows.find((window) => window.id === "session")?.id ?? windows[0]?.id ?? null,
    windows,
  };
}

export function makeClaudeOAuthUsageSource(input: {
  readonly credentialPaths: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
}): Effect.Effect<
  ProviderUsageSnapshotDraft,
  ClaudeOAuthUsageError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const accessToken = yield* readClaudeAccessToken(input.credentialPaths, input.environment);
    const request = HttpClientRequest.get("https://api.anthropic.com/api/oauth/usage").pipe(
      HttpClientRequest.bearerToken(accessToken),
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.setHeader("anthropic-beta", "oauth-2025-04-20"),
    );
    const response = yield* client.execute(request).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) => new ClaudeOAuthUsageError({ cause })),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new ClaudeOAuthUsageError({ cause: `HTTP ${response.status}` });
    }
    const payload = yield* response.json.pipe(
      Effect.mapError((cause) => new ClaudeOAuthUsageError({ cause })),
    );
    return parseClaudeOAuthUsage(payload);
  });
}

const readClaudeAccessToken = Effect.fn("readClaudeAccessToken")(function* (
  credentialPaths: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform;
  for (const path of credentialPaths) {
    const contents = yield* fileSystem.readFileString(path).pipe(Effect.option);
    if (contents._tag !== "Some") continue;
    const token = yield* parseClaudeAccessToken(contents.value).pipe(Effect.option);
    if (token._tag === "Some" && token.value) return token.value;
  }
  if (platform === "darwin") {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const stdout = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make(
            "/usr/bin/security",
            ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
            { env: environment, extendEnv: true },
          ),
        );
        const [output, exitCode] = yield* Effect.all([
          child.stdout.pipe(
            Stream.decodeText(),
            Stream.runFold(
              () => "",
              (acc, chunk) => acc + chunk,
            ),
          ),
          child.exitCode,
        ]);
        if (Number(exitCode) !== 0) {
          return yield* new ClaudeOAuthUsageError({ cause: `security exited ${exitCode}` });
        }
        return output;
      }),
    ).pipe(
      Effect.timeout("5 seconds"),
      Effect.mapError((cause) =>
        isClaudeOAuthUsageError(cause) ? cause : new ClaudeOAuthUsageError({ cause }),
      ),
    );
    const token = yield* parseClaudeAccessToken(stdout);
    if (token) return token;
  }
  return yield* new ClaudeOAuthUsageError({ cause: "credentials unavailable" });
});

const parseClaudeAccessToken = Effect.fn("parseClaudeAccessToken")(function* (json: string) {
  const decoded = yield* decodeJson(json).pipe(
    Effect.mapError((cause) => new ClaudeOAuthUsageError({ cause })),
  );
  const accessToken = asRecord(asRecord(decoded).claudeAiOauth).accessToken;
  return typeof accessToken === "string" && accessToken.length > 0 ? accessToken : null;
});

function appendWindow(
  windows: ProviderUsageWindow[],
  value: unknown,
  id: string,
  label: string,
  windowDurationMinutes: number,
): void {
  const record = asRecord(value);
  const usedPercent = numberValue(record.utilization);
  const resetsAt = dateSeconds(record.resets_at);
  if (usedPercent === null || resetsAt === null) return;
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

function dateSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds / 1_000 : null;
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
