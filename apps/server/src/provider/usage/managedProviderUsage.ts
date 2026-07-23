import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import type {
  ProviderUsageCapability,
  ProviderUsageSnapshot,
  ProviderUsageSnapshotDraft,
} from "./ProviderUsage.ts";

const CACHE_TTL = "60 seconds" as const;
const LOAD_TIMEOUT = "20 seconds" as const;
const SAFE_FAILURE_MESSAGE = "Usage data could not be refreshed.";

export function makeManagedProviderUsage<E>(input: {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
  readonly minimumRefreshInterval?: Duration.Input;
  readonly load: Effect.Effect<ProviderUsageSnapshotDraft, E>;
}): Effect.Effect<ProviderUsageCapability> {
  return Effect.gen(function* () {
    const lastGood = yield* Ref.make<ProviderUsageSnapshot | null>(null);

    const loadSnapshot = Effect.gen(function* () {
      const checkedAt = DateTime.formatIso(yield* DateTime.now);
      return yield* input.load.pipe(
        Effect.timeout(LOAD_TIMEOUT),
        Effect.map((draft): ProviderUsageSnapshot => {
          const snapshot: ProviderUsageSnapshot = {
            instanceId: input.instanceId,
            driver: input.driver,
            displayName: input.displayName,
            status: "ready",
            checkedAt,
            lastSuccessfulAt: checkedAt,
            ...draft,
          };
          return snapshot;
        }),
        Effect.tap((snapshot) => Ref.set(lastGood, snapshot)),
        Effect.catch(() =>
          Ref.get(lastGood).pipe(
            Effect.map(
              (previous): ProviderUsageSnapshot =>
                previous
                  ? {
                      ...previous,
                      status: "stale",
                      checkedAt,
                      message: SAFE_FAILURE_MESSAGE,
                    }
                  : {
                      instanceId: input.instanceId,
                      driver: input.driver,
                      displayName: input.displayName,
                      status: "error",
                      checkedAt,
                      lastSuccessfulAt: null,
                      headlineWindowId: null,
                      windows: [],
                      message: SAFE_FAILURE_MESSAGE,
                    },
            ),
          ),
        ),
      );
    });

    const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(loadSnapshot, CACHE_TTL);
    const inFlight = yield* Ref.make<Deferred.Deferred<ProviderUsageSnapshot> | null>(null);
    const lastAttempt = yield* Ref.make<{
      readonly atMillis: number;
      readonly snapshot: ProviderUsageSnapshot;
    } | null>(null);
    const minimumRefreshIntervalMillis = input.minimumRefreshInterval
      ? Duration.toMillis(input.minimumRefreshInterval)
      : 0;
    type RefreshSelection = {
      readonly deferred: Deferred.Deferred<ProviderUsageSnapshot>;
      readonly owner: boolean;
    };
    const refresh: Effect.Effect<ProviderUsageSnapshot> = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const candidate = yield* Deferred.make<ProviderUsageSnapshot>();
        const selected = yield* Ref.modify(
          inFlight,
          (current): readonly [RefreshSelection, Deferred.Deferred<ProviderUsageSnapshot> | null] =>
            current
              ? [{ deferred: current, owner: false }, current]
              : [{ deferred: candidate, owner: true }, candidate],
        );
        if (!selected.owner) return yield* restore(Deferred.await(selected.deferred));

        const nowMillis = yield* Clock.currentTimeMillis;
        const previousAttempt = yield* Ref.get(lastAttempt);
        const result = yield* restore(
          previousAttempt && nowMillis - previousAttempt.atMillis < minimumRefreshIntervalMillis
            ? Effect.succeed(previousAttempt.snapshot)
            : Effect.andThen(invalidate, cached).pipe(
                Effect.tap((snapshot) => Ref.set(lastAttempt, { atMillis: nowMillis, snapshot })),
              ),
        ).pipe(Effect.exit);
        yield* Deferred.done(candidate, result);
        yield* Ref.update(inFlight, (current) => (current === candidate ? null : current));
        if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
        return result.value;
      }),
    );
    return {
      getSnapshot: Ref.get(lastAttempt).pipe(
        Effect.flatMap((previous) => (previous ? Effect.succeed(previous.snapshot) : cached)),
      ),
      refresh,
    };
  });
}
