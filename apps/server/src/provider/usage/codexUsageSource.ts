import type { CodexSettings } from "@t3tools/contracts";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { expandHomePath } from "../../pathExpansion.ts";
import { codexAppServerArgs } from "../Layers/codexLaunchArgs.ts";
import { parseCodexUsageResponses } from "./codexUsage.ts";
import { makeCodexOAuthUsageSource, mergeCodexUsageDrafts } from "./codexOAuthUsage.ts";

const FORCE_KILL_AFTER = "2 seconds" as const;

export function makeCodexUsageSource(input: {
  readonly config: Pick<CodexSettings, "binaryPath" | "homePath" | "launchArgs">;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const resolvedHomePath = input.config.homePath
        ? expandHomePath(input.config.homePath)
        : undefined;
      const environment = {
        ...input.environment,
        ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
      };
      const spawnCommand = yield* resolveSpawnCommand(
        input.config.binaryPath,
        codexAppServerArgs(input.config.launchArgs),
        { env: environment, extendEnv: true },
      );
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            cwd: input.cwd,
            env: environment,
            extendEnv: true,
            forceKillAfter: FORCE_KILL_AFTER,
            shell: spawnCommand.shell,
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new CodexErrors.CodexAppServerSpawnError({
                command: `${input.config.binaryPath} app-server`,
                cause,
              }),
          ),
        );
      const context = yield* Layer.build(CodexClient.layerChildProcess(child));
      const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
        Effect.provide(context),
      );
      yield* client.request("initialize", {
        clientInfo: {
          name: "t3code_desktop",
          title: "T3 Code Desktop",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
      yield* client.notify("initialized", undefined);
      const [rateLimits, usage] = yield* Effect.all(
        [
          client.request("account/rateLimits/read", undefined),
          client
            .request("account/usage/read", undefined)
            .pipe(Effect.catch(() => Effect.succeed(undefined))),
        ],
        { concurrency: "unbounded" },
      );
      const base = parseCodexUsageResponses({
        rateLimits,
        ...(usage ? { usage } : {}),
        today: DateTime.formatIso(yield* DateTime.now).slice(0, 10),
      });
      const oauth = yield* makeCodexOAuthUsageSource({
        authPath: path.join(resolvedHomePath ?? path.join(NodeOS.homedir(), ".codex"), "auth.json"),
      }).pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (!oauth) return base;
      return mergeCodexUsageDrafts(base, oauth);
    }),
  );
}
