import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createProviderUsageEnvironmentAtoms,
  providerUsageRefreshConcurrencyKey,
} from "./providerUsage.ts";

describe("provider usage state", () => {
  it("keys usage subscriptions by environment", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const usage = createProviderUsageEnvironmentAtoms(runtime);
    const first = {
      environmentId: EnvironmentId.make("environment-1"),
      input: {},
    };

    expect(usage.snapshots(first)).toBe(
      usage.snapshots({ environmentId: EnvironmentId.make("environment-1"), input: {} }),
    );
    expect(
      usage.snapshots({ environmentId: EnvironmentId.make("environment-2"), input: {} }),
    ).not.toBe(usage.snapshots(first));
  });

  it("keeps refreshes for separate provider instances independent", () => {
    const environmentId = EnvironmentId.make("environment-1");

    expect(
      providerUsageRefreshConcurrencyKey({
        environmentId,
        input: { instanceId: ProviderInstanceId.make("codex-default") },
      }),
    ).not.toBe(
      providerUsageRefreshConcurrencyKey({
        environmentId,
        input: { instanceId: ProviderInstanceId.make("claude-default") },
      }),
    );
  });
});
