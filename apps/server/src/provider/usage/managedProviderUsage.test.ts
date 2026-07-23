import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { makeManagedProviderUsage } from "./managedProviderUsage.ts";

const readyDraft = {
  headlineWindowId: "primary",
  windows: [
    {
      id: "primary",
      label: "5 hours",
      usedPercent: 20,
      remainingPercent: 80,
      resetsAt: "2025-12-17T19:33:20.000Z",
      windowDurationMinutes: 300,
    },
  ],
} as const;

it.effect("coalesces concurrent refreshes, bypasses the cache manually, and caches reads", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const gate = yield* Deferred.make<void>();
    const usage = yield* makeManagedProviderUsage({
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      load: Ref.update(calls, (value) => value + 1).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.as(readyDraft),
      ),
    });

    const first = yield* usage.refresh.pipe(Effect.forkChild);
    const second = yield* usage.refresh.pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    assert.strictEqual(yield* Ref.get(calls), 1);
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);

    yield* usage.getSnapshot;
    assert.strictEqual(yield* Ref.get(calls), 1);
    yield* TestClock.adjust("59 seconds");
    yield* usage.getSnapshot;
    assert.strictEqual(yield* Ref.get(calls), 1);

    yield* usage.refresh;
    assert.strictEqual(yield* Ref.get(calls), 2);
  }),
);

it.effect("throttles sequential refreshes when a minimum refresh interval is configured", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const usage = yield* makeManagedProviderUsage({
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      minimumRefreshInterval: "5 minutes",
      load: Ref.updateAndGet(calls, (value) => value + 1).pipe(Effect.as(readyDraft)),
    });

    const first = yield* usage.refresh;
    const throttled = yield* usage.refresh;
    assert.strictEqual(yield* Ref.get(calls), 1);
    assert.deepEqual(throttled, first);

    yield* TestClock.adjust("5 minutes");
    yield* usage.refresh;
    assert.strictEqual(yield* Ref.get(calls), 2);
  }),
);

it.effect("bounds the full load and preserves the last good snapshot on timeout", () =>
  Effect.gen(function* () {
    const hangs = yield* Ref.make(false);
    const usage = yield* makeManagedProviderUsage({
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      load: Ref.get(hangs).pipe(
        Effect.flatMap((shouldHang) => (shouldHang ? Effect.never : Effect.succeed(readyDraft))),
      ),
    });

    const good = yield* usage.refresh;
    yield* Ref.set(hangs, true);
    const refresh = yield* usage.refresh.pipe(Effect.timeout("21 seconds"), Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust("21 seconds");
    const stale = yield* Fiber.join(refresh);

    assert.strictEqual(good.status, "ready");
    assert.strictEqual(stale.status, "stale");
    assert.deepEqual(stale.windows, good.windows);
  }),
);

it.effect("returns the last good snapshot as stale without exposing the source error", () =>
  Effect.gen(function* () {
    const fail = yield* Ref.make(false);
    const usage = yield* makeManagedProviderUsage({
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      load: Ref.get(fail).pipe(
        Effect.flatMap((shouldFail) =>
          shouldFail
            ? Effect.fail({ _tag: "TestError", detail: "secret upstream response" })
            : Effect.succeed(readyDraft),
        ),
      ),
    });

    const good = yield* usage.refresh;
    yield* Ref.set(fail, true);
    yield* TestClock.adjust("61 seconds");
    const stale = yield* usage.refresh;

    assert.strictEqual(good.status, "ready");
    assert.strictEqual(stale.status, "stale");
    assert.deepEqual(stale.windows, good.windows);
    assert.notInclude(stale.message ?? "", "secret upstream response");
  }),
);
