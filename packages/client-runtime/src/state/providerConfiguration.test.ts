import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";

import {
  providerConfigurationMutationKey,
  providerSkillMutationKey,
} from "./providerConfiguration.ts";

describe("provider configuration command scheduling", () => {
  it("serializes drafts per environment, instance, and scope", () => {
    expect(
      providerConfigurationMutationKey({
        environmentId: "env-1",
        input: {
          target: {
            instanceId: ProviderInstanceId.make("codex"),
            scope: { type: "project", projectId: ProjectId.make("project-1") },
          },
          changes: [],
        },
      }),
    ).toBe('["env-1","codex","project","project-1"]');
  });

  it("serializes all skills CLI mutations per environment", () => {
    expect(providerSkillMutationKey({ environmentId: "env-1" })).toBe("env-1");
  });
});
