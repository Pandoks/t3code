import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as PubSub from "effect/PubSub";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ProviderInstance } from "../ProviderDriver.ts";
import type { ProviderInstanceRegistryShape } from "../Services/ProviderInstanceRegistry.ts";
import { makeProviderUsageRegistry } from "./ProviderUsageRegistry.ts";

const instanceId = ProviderInstanceId.make("codex-work");
const driver = ProviderDriverKind.make("codex");

it.effect("aggregates only instances that expose a usage capability", () =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<void>();
    const ready = {
      instanceId,
      driver,
      displayName: "Work Codex",
      status: "ready" as const,
      checkedAt: "2026-07-22T12:00:00.000Z",
      lastSuccessfulAt: "2026-07-22T12:00:00.000Z",
      headlineWindowId: null,
      windows: [],
    };
    const instances = {
      listInstances: Effect.succeed([
        {
          instanceId,
          driverKind: driver,
          displayName: "Work Codex",
          usage: { getSnapshot: Effect.succeed(ready), refresh: Effect.succeed(ready) },
        },
        {
          instanceId: ProviderInstanceId.make("cursor"),
          driverKind: ProviderDriverKind.make("cursor"),
          displayName: "Cursor",
        },
      ] as unknown as ReadonlyArray<ProviderInstance>),
      streamChanges: Stream.never,
      subscribeChanges: PubSub.subscribe(changes),
    } as unknown as ProviderInstanceRegistryShape;
    const registry = yield* makeProviderUsageRegistry(instances);
    const result = yield* registry.getSnapshotList;

    assert.strictEqual(result.snapshots[0]?.status, "ready");
    assert.strictEqual(result.snapshots.length, 1);
  }),
);

it.effect("publishes refreshing state and the completed manual refresh to subscribers", () =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<void>();
    const refreshCalls = yield* Ref.make(0);
    const snapshot = (call: number) => ({
      instanceId,
      driver,
      displayName: "Work Codex",
      status: "ready" as const,
      checkedAt: `2026-07-22T12:00:0${call}.000Z`,
      lastSuccessfulAt: `2026-07-22T12:00:0${call}.000Z`,
      headlineWindowId: null,
      windows: [],
    });
    const instances = {
      listInstances: Effect.succeed([
        {
          instanceId,
          driverKind: driver,
          displayName: "Work Codex",
          usage: {
            getSnapshot: Effect.succeed(snapshot(0)),
            refresh: Ref.updateAndGet(refreshCalls, (value) => value + 1).pipe(
              Effect.map(snapshot),
            ),
          },
        },
      ] as unknown as ReadonlyArray<ProviderInstance>),
      streamChanges: Stream.never,
      subscribeChanges: PubSub.subscribe(changes),
    } as unknown as ProviderInstanceRegistryShape;
    const registry = yield* makeProviderUsageRegistry(instances);
    yield* Effect.yieldNow;

    const events = yield* registry.streamChanges.pipe(
      Stream.drop(2),
      Stream.take(2),
      Stream.runCollect,
      Effect.timeout("1 second"),
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    yield* registry.refresh({ instanceId });
    yield* TestClock.adjust("1 second");
    const published = Array.from(yield* Fiber.join(events));

    assert.deepEqual(
      published.map((event) => event.snapshots[0]?.status),
      ["refreshing", "ready"],
    );
    assert.strictEqual(published[1]?.snapshots[0]?.checkedAt, "2026-07-22T12:00:02.000Z");
  }),
);

it.effect("acquires the instance change subscription before returning", () =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<void>();
    const refreshCalls = yield* Ref.make(0);
    const ready = {
      instanceId,
      driver,
      displayName: "Work Codex",
      status: "ready" as const,
      checkedAt: "2026-07-22T12:00:00.000Z",
      lastSuccessfulAt: "2026-07-22T12:00:00.000Z",
      headlineWindowId: null,
      windows: [],
    };
    const instances = {
      listInstances: Effect.succeed([
        {
          instanceId,
          driverKind: driver,
          displayName: "Work Codex",
          usage: {
            getSnapshot: Effect.succeed(ready),
            refresh: Ref.update(refreshCalls, (value) => value + 1).pipe(Effect.as(ready)),
          },
        },
      ] as unknown as ReadonlyArray<ProviderInstance>),
      streamChanges: Stream.never,
      subscribeChanges: PubSub.subscribe(changes),
    } as unknown as ProviderInstanceRegistryShape;

    yield* makeProviderUsageRegistry(instances);
    yield* PubSub.publish(changes, undefined);
    yield* Effect.yieldNow;

    assert.strictEqual(yield* Ref.get(refreshCalls), 2);
  }),
);

it.effect("streams the initial refreshing snapshot followed by startup completion", () =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<void>();
    const gate = yield* Deferred.make<void>();
    const ready = {
      instanceId,
      driver,
      displayName: "Work Codex",
      status: "ready" as const,
      checkedAt: "2026-07-22T12:00:01.000Z",
      lastSuccessfulAt: "2026-07-22T12:00:01.000Z",
      headlineWindowId: null,
      windows: [],
    };
    const instances = {
      listInstances: Effect.succeed([
        {
          instanceId,
          driverKind: driver,
          displayName: "Work Codex",
          usage: {
            getSnapshot: Effect.succeed(ready),
            refresh: Deferred.await(gate).pipe(Effect.as(ready)),
          },
        },
      ] as unknown as ReadonlyArray<ProviderInstance>),
      streamChanges: Stream.never,
      subscribeChanges: PubSub.subscribe(changes),
    } as unknown as ProviderInstanceRegistryShape;
    const registry = yield* makeProviderUsageRegistry(instances);
    const events = yield* registry.streamChanges.pipe(
      Stream.filter((event) => event.snapshots[0]?.status !== undefined),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    yield* Deferred.succeed(gate, undefined);
    const published = Array.from(yield* Fiber.join(events));

    assert.deepEqual(
      published.map((event) => event.snapshots[0]?.status),
      ["refreshing", "ready"],
    );
  }),
);
