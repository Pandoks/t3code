// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the Node filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  readClaudeConfiguration,
  readCodexConfiguration,
} from "./ProviderConfigurationAdapters.ts";

const { mkdtemp, mkdir, writeFile } = NodeFSP;
const { tmpdir } = NodeOS;
const { join } = NodePath;

describe("provider configuration adapters", () => {
  it("reads only curated Codex user resources and excludes auth state", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-codex-config-"));
    await writeFile(join(root, "config.toml"), 'model = "gpt-5"\n');
    await writeFile(join(root, "AGENTS.md"), "Use tests.\n");
    await writeFile(join(root, "auth.json"), '{"token":"secret"}');

    const snapshot = await readCodexConfiguration({ root, scope: "user" });
    expect(snapshot.resources.map((resource) => resource.id)).toEqual(["settings", "instructions"]);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });

  it("uses repository-local Codex resources for project scope", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "t3-codex-project-"));
    await mkdir(join(projectRoot, ".codex"));
    await writeFile(join(projectRoot, ".codex", "config.toml"), "web_search = true\n");
    await writeFile(join(projectRoot, "AGENTS.md"), "Project instructions.\n");

    const snapshot = await readCodexConfiguration({ root: projectRoot, scope: "project" });
    expect(snapshot.resources.map((resource) => resource.nativePathLabel)).toEqual([
      ".codex/config.toml",
      "AGENTS.md",
    ]);
  });

  it("keeps Claude project settings and instructions separate", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "t3-claude-project-"));
    await mkdir(join(projectRoot, ".claude"));
    await writeFile(join(projectRoot, ".claude", "settings.json"), '{"permissions":{}}\n');
    await writeFile(join(projectRoot, "CLAUDE.md"), "Claude project instructions.\n");

    const snapshot = await readClaudeConfiguration({ root: projectRoot, scope: "project" });
    expect(snapshot.resources.map((resource) => resource.id)).toEqual(["settings", "instructions"]);
    expect(snapshot.resources[0]?.value).toEqual({ permissions: {} });
  });

  it("reports invalid native settings without exposing unrelated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-claude-config-"));
    await writeFile(join(root, "settings.json"), "{not json");
    await writeFile(join(root, "credentials.json"), '{"secret":"hidden"}');

    const snapshot = await readClaudeConfiguration({ root, scope: "user" });
    expect(snapshot.issues).toHaveLength(1);
    expect(snapshot.resources.map((resource) => resource.id)).toEqual(["settings", "instructions"]);
    expect(JSON.stringify(snapshot)).not.toContain("hidden");
  });
});
