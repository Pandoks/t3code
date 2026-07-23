import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ApplyProviderConfigurationInput,
  InitializeProviderSkillInput,
  ProviderConfigurationSnapshotInput,
  ProviderSkillActionInput,
} from "./providerConfiguration.ts";

describe("provider configuration contracts", () => {
  it("decodes user and project targets without accepting filesystem paths", () => {
    const decode = Schema.decodeUnknownSync(ProviderConfigurationSnapshotInput);
    expect(decode({ instanceId: "codex", scope: { type: "user" } })).toEqual({
      instanceId: "codex",
      scope: { type: "user" },
    });
    expect(
      decode({ instanceId: "claudeAgent", scope: { type: "project", projectId: "project-1" } }),
    ).toEqual({
      instanceId: "claudeAgent",
      scope: { type: "project", projectId: "project-1" },
    });
    expect(
      decode({ instanceId: "codex", scope: { type: "user" }, path: "/tmp/escape" }),
    ).not.toHaveProperty("path");
  });

  it("requires optimistic revisions for every configuration change", () => {
    const decode = Schema.decodeUnknownSync(ApplyProviderConfigurationInput);
    expect(() =>
      decode({
        target: { instanceId: "codex", scope: { type: "user" } },
        changes: [{ resourceId: "settings", operation: "write", value: {} }],
      }),
    ).toThrow();
  });

  it("decodes explicit non-interactive skill actions", () => {
    const decode = Schema.decodeUnknownSync(ProviderSkillActionInput);
    expect(
      decode({
        target: { instanceId: "codex", scope: { type: "user" } },
        action: {
          type: "install",
          package: "Pandoks/skills",
          skills: ["ground"],
          agents: ["codex"],
        },
      }).action.type,
    ).toBe("install");
    expect(() =>
      decode({
        target: { instanceId: "codex", scope: { type: "user" } },
        action: { type: "shell", command: "rm" },
      }),
    ).toThrow();
  });

  it("validates skill initialization inputs without accepting an absolute target path", () => {
    const decode = Schema.decodeUnknownSync(InitializeProviderSkillInput);
    expect(
      decode({
        instanceId: "codex",
        parentDirectory: "/tmp/skills",
        name: "my-skill",
        agents: ["codex"],
        installMode: "symlink",
      }).name,
    ).toBe("my-skill");
    expect(() =>
      decode({
        instanceId: "codex",
        parentDirectory: "/tmp/skills",
        name: "../escape",
        agents: ["codex"],
        installMode: "symlink",
      }),
    ).toThrow();
  });
});
