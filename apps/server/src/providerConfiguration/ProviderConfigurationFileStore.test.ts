// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the Node filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  applyConfigurationFiles,
  readConfigurationFile,
  resolveFileWithinRoot,
} from "./ProviderConfigurationFileStore.ts";

const { mkdtemp, readFile, stat, symlink, writeFile } = NodeFSP;
const { tmpdir } = NodeOS;
const { join } = NodePath;

describe("ProviderConfigurationFileStore", () => {
  it("writes atomically, preserves permissions, and creates a recoverable backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-provider-config-"));
    const file = join(root, "settings.json");
    await writeFile(file, '{"before":true}\n', { mode: 0o640 });
    const resource = await readConfigurationFile(root, "settings.json");

    const result = await applyConfigurationFiles(root, [
      {
        relativePath: "settings.json",
        expectedRevision: resource.revision,
        operation: "write",
        contents: '{"after":true}\n',
      },
    ]);

    expect(await readFile(file, "utf8")).toBe('{"after":true}\n');
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    expect(await readFile(result.backups[0]!, "utf8")).toBe('{"before":true}\n');
  });

  it("rejects stale revisions before changing any file", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-provider-config-"));
    await writeFile(join(root, "one"), "one");
    await writeFile(join(root, "two"), "two");
    const one = await readConfigurationFile(root, "one");

    await expect(
      applyConfigurationFiles(root, [
        {
          relativePath: "one",
          expectedRevision: one.revision,
          operation: "write",
          contents: "changed",
        },
        { relativePath: "two", expectedRevision: "stale", operation: "write", contents: "changed" },
      ]),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await readFile(join(root, "one"), "utf8")).toBe("one");
  });

  it("rejects symlink escapes from the adapter-owned root", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-provider-config-"));
    const outside = await mkdtemp(join(tmpdir(), "t3-provider-outside-"));
    await writeFile(join(outside, "secret"), "secret");
    await symlink(outside, join(root, "escape"));

    await expect(resolveFileWithinRoot(root, "escape/secret")).rejects.toMatchObject({
      code: "path_violation",
    });
  });
});
