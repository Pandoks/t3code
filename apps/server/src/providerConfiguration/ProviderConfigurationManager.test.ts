// @effect-diagnostics nodeBuiltinImport:off - Tests exercise temporary provider homes.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";

import { makeProviderConfigurationManager } from "./ProviderConfigurationManager.ts";

const { mkdtemp, mkdir, readFile, writeFile } = NodeFSP;
const { tmpdir } = NodeOS;
const { join } = NodePath;

describe("ProviderConfigurationManager", () => {
  it("loads and applies guarded Claude configuration changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "t3-claude-home-"));
    await writeFile(join(home, "settings.json"), '{"model":"sonnet"}\n');
    const manager = makeProviderConfigurationManager({
      resolveTarget: async () => ({ provider: "claudeAgent", root: home, cwd: home }),
      skills: {
        probe: async () => ({ available: false }),
        list: async () => ({ available: false, skills: [] }),
      },
    });
    const snapshot = await manager.getSnapshot({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      scope: { type: "user" },
    });
    const settings = snapshot.resources.find((resource) => resource.id === "settings")!;
    const result = await manager.applyDraft({
      target: snapshot.target,
      changes: [
        {
          resourceId: "settings",
          expectedRevision: settings.revision,
          operation: "write",
          value: { model: "opus" },
        },
      ],
    });
    expect(result.restartRequired).toBe(true);
    expect(JSON.parse(await readFile(join(home, "settings.json"), "utf8"))).toEqual({
      model: "opus",
    });
  });

  it("validates all changes before writing any resource", async () => {
    const home = await mkdtemp(join(tmpdir(), "t3-claude-home-"));
    await writeFile(join(home, "settings.json"), "{}\n");
    await writeFile(join(home, "CLAUDE.md"), "before\n");
    const manager = makeProviderConfigurationManager({
      resolveTarget: async () => ({ provider: "claudeAgent", root: home, cwd: home }),
      skills: {
        probe: async () => ({ available: false }),
        list: async () => ({ available: false, skills: [] }),
      },
    });
    const snapshot = await manager.getSnapshot({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      scope: { type: "user" },
    });
    const instructions = snapshot.resources.find((resource) => resource.id === "instructions")!;
    const validation = await manager.validateDraft({
      target: snapshot.target,
      changes: [
        {
          resourceId: "instructions",
          expectedRevision: instructions.revision,
          operation: "write",
          value: "after\n",
        },
        { resourceId: "missing", expectedRevision: "missing", operation: "write", value: "bad" },
      ],
    });
    expect(validation.valid).toBe(false);
    expect(await readFile(join(home, "CLAUDE.md"), "utf8")).toBe("before\n");
  });

  it("uses the selected project root rather than the provider home", async () => {
    const project = await mkdtemp(join(tmpdir(), "t3-provider-project-"));
    await mkdir(join(project, ".codex"));
    await writeFile(join(project, ".codex", "config.toml"), "model = 'gpt-5'\n");
    const manager = makeProviderConfigurationManager({
      resolveTarget: async () => ({ provider: "codex", root: project, cwd: project }),
      skills: {
        probe: async () => ({ available: false }),
        list: async () => ({ available: false, skills: [] }),
      },
    });
    const snapshot = await manager.getSnapshot({
      instanceId: ProviderInstanceId.make("codex"),
      scope: { type: "project", projectId: ProjectId.make("project-1") },
    });
    expect(snapshot.resources[0]?.nativePathLabel).toBe(".codex/config.toml");
  });
});
