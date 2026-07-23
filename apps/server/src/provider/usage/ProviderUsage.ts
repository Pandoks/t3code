import type {
  ProviderUsageHistory,
  ProviderUsageSnapshot,
  ProviderUsageWindow,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export type { ProviderUsageHistory, ProviderUsageSnapshot, ProviderUsageWindow };

export interface ProviderUsageSnapshotDraft {
  readonly planLabel?: string;
  readonly headlineWindowId: string | null;
  readonly windows: ReadonlyArray<ProviderUsageWindow>;
  readonly history?: ProviderUsageHistory;
}

export interface ProviderUsageCapability {
  readonly getSnapshot: Effect.Effect<ProviderUsageSnapshot>;
  readonly refresh: Effect.Effect<ProviderUsageSnapshot>;
}
