import { type ProviderUsageRefreshInput, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function providerUsageRefreshConcurrencyKey(value: {
  readonly environmentId: string;
  readonly input: ProviderUsageRefreshInput;
}): string {
  return JSON.stringify([value.environmentId, value.input.instanceId ?? null]);
}

export function createProviderUsageEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const refreshScheduler = createAtomCommandScheduler();

  return {
    snapshots: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:provider-usage:snapshots",
      tag: WS_METHODS.subscribeProviderUsage,
    }),
    refresh: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-usage:refresh",
      tag: WS_METHODS.providerUsageRefresh,
      scheduler: refreshScheduler,
      concurrency: {
        mode: "singleFlight",
        key: providerUsageRefreshConcurrencyKey,
      },
    }),
  };
}
