import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function providerConfigurationMutationKey(value: {
  readonly environmentId: string;
  readonly input: {
    readonly target: {
      readonly instanceId: string;
      readonly scope:
        | { readonly type: "user" }
        | { readonly type: "project"; readonly projectId: string };
    };
  } & Readonly<Record<string, unknown>>;
}): string {
  const scope = value.input.target.scope;
  return JSON.stringify([
    value.environmentId,
    value.input.target.instanceId,
    scope.type,
    scope.type === "project" ? scope.projectId : null,
  ]);
}

export function providerSkillMutationKey(value: { readonly environmentId: string }): string {
  return value.environmentId;
}

export function createProviderConfigurationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const draftScheduler = createAtomCommandScheduler();
  const skillScheduler = createAtomCommandScheduler();
  return {
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:provider-configuration:snapshot",
      tag: WS_METHODS.providerConfigurationGetSnapshot,
      staleTimeMs: 5_000,
    }),
    validate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-configuration:validate",
      tag: WS_METHODS.providerConfigurationValidateDraft,
      scheduler: draftScheduler,
      concurrency: { mode: "latest", key: providerConfigurationMutationKey },
    }),
    apply: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-configuration:apply",
      tag: WS_METHODS.providerConfigurationApplyDraft,
      scheduler: draftScheduler,
      concurrency: { mode: "serial", key: providerConfigurationMutationKey },
    }),
    runSkillAction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-configuration:skill-action",
      tag: WS_METHODS.providerConfigurationRunSkillAction,
      scheduler: skillScheduler,
      concurrency: { mode: "serial", key: providerSkillMutationKey },
    }),
    initializeSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-configuration:initialize-skill",
      tag: WS_METHODS.providerConfigurationInitializeSkill,
      scheduler: skillScheduler,
      concurrency: { mode: "serial", key: providerSkillMutationKey },
    }),
  };
}
