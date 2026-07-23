import type {
  ProviderInstanceId,
  ProviderUsageRefreshInput,
  ProviderUsageSnapshot,
  ProviderUsageSnapshotList,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as Scope from "effect/Scope";

import type { ProviderInstance } from "../ProviderDriver.ts";
import {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderUsageRegistry,
  type ProviderUsageRegistryShape,
} from "../Services/ProviderUsageRegistry.ts";

const REFRESH_INTERVAL = "60 seconds" as const;

const supportedInstances = (instances: ReadonlyArray<ProviderInstance>) =>
  instances.filter(
    (
      instance,
    ): instance is ProviderInstance & { readonly usage: NonNullable<ProviderInstance["usage"]> } =>
      instance.usage !== undefined,
  );

const refreshingSnapshot = Effect.fn("ProviderUsageRegistry.refreshingSnapshot")(function* (
  instance: ProviderInstance,
  previous?: ProviderUsageSnapshot,
): Effect.fn.Return<ProviderUsageSnapshot> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (previous) {
    const { message: _message, ...snapshot } = previous;
    return { ...snapshot, status: "refreshing", checkedAt };
  }
  return {
    instanceId: instance.instanceId,
    driver: instance.driverKind,
    displayName: instance.displayName ?? instance.driverKind,
    status: "refreshing",
    checkedAt,
    lastSuccessfulAt: null,
    headlineWindowId: null,
    windows: [],
  };
});

export const makeProviderUsageRegistry = Effect.fn("makeProviderUsageRegistry")(function* (
  instances: ProviderInstanceRegistryShape,
): Effect.fn.Return<ProviderUsageRegistryShape, never, Scope.Scope> {
  const initialInstances = supportedInstances(yield* instances.listInstances);
  const initialSnapshots = yield* Effect.forEach(initialInstances, (instance) =>
    refreshingSnapshot(instance),
  );
  const state = yield* SubscriptionRef.make<ProviderUsageSnapshotList>({
    snapshots: initialSnapshots,
  });
  const initialState = yield* SubscriptionRef.get(state);

  const collect = (options?: {
    readonly refresh?: boolean;
    readonly instanceId?: ProviderInstanceId;
  }) =>
    Effect.gen(function* () {
      const currentInstances = supportedInstances(yield* instances.listInstances);
      const previous = new Map(
        (yield* SubscriptionRef.get(state)).snapshots.map((snapshot) => [
          snapshot.instanceId,
          snapshot,
        ]),
      );

      if (options?.refresh) {
        const snapshots = yield* Effect.forEach(currentInstances, (instance) => {
          const existing = previous.get(instance.instanceId);
          const isTarget = !options.instanceId || options.instanceId === instance.instanceId;
          return isTarget
            ? refreshingSnapshot(instance, existing)
            : Effect.succeed(existing).pipe(
                Effect.flatMap((snapshot) =>
                  snapshot ? Effect.succeed(snapshot) : refreshingSnapshot(instance),
                ),
              );
        });
        yield* SubscriptionRef.set(state, { snapshots });
      }

      const snapshots = yield* Effect.forEach(
        currentInstances,
        (instance) => {
          const isTarget = !options?.instanceId || options.instanceId === instance.instanceId;
          return options?.refresh && isTarget ? instance.usage.refresh : instance.usage.getSnapshot;
        },
        { concurrency: "unbounded" },
      );
      const result = { snapshots } satisfies ProviderUsageSnapshotList;
      yield* SubscriptionRef.set(state, result);
      return result;
    });

  const getSnapshotList = SubscriptionRef.get(state);
  const refresh = (input?: ProviderUsageRefreshInput) =>
    collect({ refresh: true, ...(input?.instanceId ? { instanceId: input.instanceId } : {}) });

  const changes = yield* instances.subscribeChanges;
  yield* PubSub.take(changes).pipe(Effect.andThen(refresh()), Effect.forever, Effect.forkScoped);
  yield* refresh().pipe(Effect.forkScoped);
  yield* Effect.sleep(REFRESH_INTERVAL).pipe(
    Effect.andThen(refresh()),
    Effect.forever,
    Effect.forkScoped,
  );

  return ProviderUsageRegistry.of({
    getSnapshotList,
    refresh,
    refreshInstance: (instanceId) => refresh({ instanceId }),
    streamChanges: Stream.concat(Stream.succeed(initialState), SubscriptionRef.changes(state)).pipe(
      Stream.changes,
    ),
  });
});

export const ProviderUsageRegistryLive = Layer.effect(
  ProviderUsageRegistry,
  Effect.flatMap(ProviderInstanceRegistry, makeProviderUsageRegistry),
);
