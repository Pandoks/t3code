import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as TestClock from "effect/testing/TestClock";

import * as PtyAdapter from "../../terminal/PtyAdapter.ts";
import { makeClaudeNativeUsageSource } from "./claudeUsageProbe.ts";

const SCREEN = `
Current session
████████░░ 78% used
Resets 4pm (America/Los_Angeles)
`;

it.effect("releases the native usage PTY and its temporary working directory", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    let onData: (chunk: string) => void = () => undefined;
    let spawnedCwd: string | undefined;
    let disposeCount = 0;
    let killCount = 0;
    const writes: Array<string> = [];

    const process: PtyAdapter.PtyProcess = {
      pid: 1,
      write(data) {
        writes.push(data);
        if (data === "/usage\r") onData(SCREEN);
      },
      resize() {},
      kill() {
        killCount++;
      },
      onData(callback) {
        onData = callback;
        return () => {
          disposeCount++;
        };
      },
      onExit() {
        return () => undefined;
      },
    };
    const pty = PtyAdapter.PtyAdapter.of({
      spawn: (input) =>
        Effect.sync(() => {
          spawnedCwd = input.cwd;
          return process;
        }),
    });

    const fiber = yield* makeClaudeNativeUsageSource({
      config: { binaryPath: "claude" },
      environment: {},
    }).pipe(Effect.provideService(PtyAdapter.PtyAdapter, pty), Effect.forkScoped);

    yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.seconds(3));
    const snapshot = yield* Fiber.join(fiber);

    expect(snapshot.headlineWindowId).toBe("session");
    expect(writes).toContain("/usage\r");
    expect(writes).toContain("/exit\r");
    expect(killCount).toBe(1);
    expect(disposeCount).toBe(1);
    expect(spawnedCwd).toBeDefined();
    expect(yield* fileSystem.exists(spawnedCwd!)).toBe(false);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("reissues the native usage command while the panel is still loading", () =>
  Effect.gen(function* () {
    let onData: (chunk: string) => void = () => undefined;
    let usageWrites = 0;
    const process: PtyAdapter.PtyProcess = {
      pid: 1,
      write(data) {
        if (data !== "/usage\r") return;
        usageWrites++;
        onData(usageWrites === 1 ? "Loading usage…" : SCREEN);
      },
      resize() {},
      kill() {},
      onData(callback) {
        onData = callback;
        return () => undefined;
      },
      onExit() {
        return () => undefined;
      },
    };
    const pty = PtyAdapter.PtyAdapter.of({ spawn: () => Effect.succeed(process) });

    const fiber = yield* makeClaudeNativeUsageSource({
      config: { binaryPath: "claude" },
      environment: {},
    }).pipe(Effect.provideService(PtyAdapter.PtyAdapter, pty), Effect.forkScoped);
    yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.seconds(8));
    const snapshot = yield* Fiber.join(fiber);

    expect(snapshot.headlineWindowId).toBe("session");
    expect(usageWrites).toBeGreaterThanOrEqual(2);
  }).pipe(Effect.provide(NodeServices.layer)),
);
