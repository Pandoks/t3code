import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as PtyAdapter from "../../terminal/PtyAdapter.ts";
import type { ProviderUsageSnapshotDraft } from "./ProviderUsage.ts";
import { parseClaudeUsageScreen, renderAnsiTerminal } from "./claudeUsage.ts";

const TERMINAL_COLUMNS = 160;
const TERMINAL_ROWS = 150;
const STARTUP_WAIT = "2 seconds" as const;
const LOADING_RETRY_WAIT = "3 seconds" as const;
const MAX_LOADING_ATTEMPTS = 3;

export class ClaudeUsageProbeError extends Schema.TaggedErrorClass<ClaudeUsageProbeError>()(
  "ClaudeUsageProbeError",
  {
    reason: Schema.Literals(["no-usage-windows", "timed-out"]),
  },
) {
  override get message(): string {
    return "Claude usage limits were not available from the native usage panel.";
  }
}

export function makeClaudeNativeUsageSource(input: {
  readonly config: Pick<ClaudeSettings, "binaryPath">;
  readonly environment: NodeJS.ProcessEnv;
}): Effect.Effect<
  ProviderUsageSnapshotDraft,
  ClaudeUsageProbeError | PlatformError.PlatformError | PtyAdapter.PtySpawnError,
  FileSystem.FileSystem | PtyAdapter.PtyAdapter
> {
  const probe = Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pty = yield* PtyAdapter.PtyAdapter;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-usage-" });
      const process = yield* Effect.acquireRelease(
        pty.spawn({
          shell: input.config.binaryPath,
          args: ["--safe-mode", "--permission-mode", "dontAsk"],
          cwd,
          cols: TERMINAL_COLUMNS,
          rows: TERMINAL_ROWS,
          env: { ...input.environment, TERM: "xterm-256color" },
        }),
        (child) =>
          Effect.sync(() => {
            child.write("\u001b");
            child.write("/exit\r");
            child.kill();
          }),
      );
      let capture = "";
      const dispose = process.onData((chunk) => {
        capture += chunk;
      });
      yield* Effect.addFinalizer(() => Effect.sync(dispose));

      yield* Effect.sleep(STARTUP_WAIT);
      process.write("/usage\r");
      for (let attempt = 0; attempt < MAX_LOADING_ATTEMPTS; attempt++) {
        yield* Effect.sleep(LOADING_RETRY_WAIT);
        const screen = renderAnsiTerminal(capture, TERMINAL_COLUMNS, TERMINAL_ROWS);
        const usage = parseClaudeUsageScreen(screen);
        if (usage.windows.length > 0) return usage;
        if (attempt + 1 < MAX_LOADING_ATTEMPTS) {
          process.write("r");
        }
      }
      return yield* new ClaudeUsageProbeError({ reason: "no-usage-windows" });
    }),
  );

  return probe.pipe(
    Effect.timeout("12 seconds"),
    Effect.catchTag("TimeoutError", () => new ClaudeUsageProbeError({ reason: "timed-out" })),
  );
}
