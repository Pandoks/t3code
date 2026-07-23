import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Option from "effect/Option";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { expandHomePath } from "../../pathExpansion.ts";
import * as PtyAdapter from "../../terminal/PtyAdapter.ts";
import type { ProviderUsageSnapshotDraft } from "./ProviderUsage.ts";
import {
  aggregateClaudeHistory,
  isClaudeHistoryFileEligible,
  parseClaudeHistoryLine,
  type ClaudeHistoryRecord,
} from "./claudeHistory.ts";
import { makeClaudeNativeUsageSource, type ClaudeUsageProbeError } from "./claudeUsageProbe.ts";
import { makeClaudeOAuthUsageSource } from "./claudeOAuthUsage.ts";

const makeRuntimePtyAdapter = Effect.suspend(() => {
  if (typeof Bun !== "undefined") {
    return Effect.promise(() => import("../../terminal/BunPtyAdapter.ts")).pipe(
      Effect.flatMap((module) => module.make()),
    );
  }
  return Effect.promise(() => import("../../terminal/NodePtyAdapter.ts")).pipe(
    Effect.flatMap((module) => module.make()),
  );
});

const readClaudeHistoryRecords = Effect.fn("readClaudeHistoryRecords")(function* (
  root: string,
  cutoffEpochMillis: number,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectsPath = path.join(root, "projects");
  const relativePaths = yield* fileSystem
    .readDirectory(projectsPath, { recursive: true })
    .pipe(
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error),
      ),
    );

  const records: ClaudeHistoryRecord[] = [];
  for (const relativePath of relativePaths) {
    if (!relativePath.endsWith(".jsonl")) continue;
    const absolutePath = path.join(projectsPath, relativePath);
    const info = yield* fileSystem
      .stat(absolutePath)
      .pipe(
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
        ),
      );
    if (
      info === null ||
      info.type !== "File" ||
      !isClaudeHistoryFileEligible(
        {
          mtimeEpochMillis: Option.getOrUndefined(info.mtime)?.getTime(),
          sizeBytes: Number(info.size),
        },
        cutoffEpochMillis,
      )
    ) {
      continue;
    }
    const contents = yield* fileSystem
      .readFileString(absolutePath)
      .pipe(
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
        ),
      );
    for (const line of contents.split("\n")) {
      const record = parseClaudeHistoryLine(line);
      if (record) records.push(record);
    }
  }
  return records;
});

export function makeClaudeUsageSource(input: {
  readonly config: Pick<ClaudeSettings, "binaryPath" | "homePath">;
  readonly environment: NodeJS.ProcessEnv;
}): Effect.Effect<
  ProviderUsageSnapshotDraft,
  PlatformError.PlatformError | ClaudeUsageProbeError | PtyAdapter.PtySpawnError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const ptyAdapter = yield* makeRuntimePtyAdapter;
    const configured = input.config.homePath.trim();
    const configPath = path.resolve(
      configured.length > 0 ? expandHomePath(configured) : path.join(NodeOS.homedir(), ".claude"),
    );
    const now = yield* DateTime.now;
    const today = DateTime.formatIso(now).slice(0, 10);
    const historyCutoffEpochMillis = DateTime.toEpochMillis(DateTime.subtract(now, { days: 30 }));
    const [quota, records] = yield* Effect.all([
      makeClaudeOAuthUsageSource({
        credentialPaths: [
          path.join(configPath, ".credentials.json"),
          path.join(NodeOS.homedir(), ".claude", ".credentials.json"),
        ],
        environment: input.environment,
      }).pipe(
        Effect.catch(() =>
          makeClaudeNativeUsageSource(input).pipe(
            Effect.provideService(PtyAdapter.PtyAdapter, ptyAdapter),
          ),
        ),
      ),
      readClaudeHistoryRecords(configPath, historyCutoffEpochMillis).pipe(
        Effect.catch(() => Effect.succeed([])),
      ),
    ]);
    return {
      ...quota,
      history: aggregateClaudeHistory({ today, records }),
    };
  });
}
