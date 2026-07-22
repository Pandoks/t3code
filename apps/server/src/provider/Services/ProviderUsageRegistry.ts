import type {
  ProviderInstanceId,
  ProviderUsageRefreshInput,
  ProviderUsageSnapshotList,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface ProviderUsageRegistryShape {
  readonly getSnapshotList: Effect.Effect<ProviderUsageSnapshotList>;
  readonly refresh: (input?: ProviderUsageRefreshInput) => Effect.Effect<ProviderUsageSnapshotList>;
  readonly streamChanges: Stream.Stream<ProviderUsageSnapshotList>;
  readonly refreshInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderUsageSnapshotList>;
}

export class ProviderUsageRegistry extends Context.Service<
  ProviderUsageRegistry,
  ProviderUsageRegistryShape
>()("t3/provider/Services/ProviderUsageRegistry") {}
