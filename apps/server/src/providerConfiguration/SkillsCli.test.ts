// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the external CLI boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { SkillsCli } from "./SkillsCli.ts";

const { chmod, mkdtemp, mkdir, readFile, writeFile } = NodeFSP;
const { tmpdir } = NodeOS;
const { join } = NodePath;

async function makeFakeSkillsCli(): Promise<{ binary: string; log: string }> {
  const root = await mkdtemp(join(tmpdir(), "t3-skills-cli-"));
  const binary = join(root, "skills");
  const log = join(root, "commands.log");
  await writeFile(
    binary,
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = "--version" ]; then printf '1.4.2\\n'; exit 0; fi
if [ "$1" = "list" ]; then printf '[{"name":"ground","path":"/tmp/ground","agents":["codex"],"source":"Pandoks/skills"}]\\n'; exit 0; fi
if [ "$1" = "init" ]; then mkdir -p "$2"; printf '%s\\n' '---' 'name: test' '---' > "$2/SKILL.md"; exit 0; fi
exit 0
`,
  );
  await chmod(binary, 0o755);
  return { binary, log };
}

describe("SkillsCli", () => {
  it("probes version and parses machine-readable inventory", async () => {
    const fake = await makeFakeSkillsCli();
    const cli = new SkillsCli(fake.binary);
    expect(await cli.probe()).toEqual({ available: true, version: "1.4.2" });
    expect(
      (await cli.list({ cwd: "/tmp", scope: "global", agents: ["codex"] })).skills[0],
    ).toMatchObject({
      name: "ground",
      directory: "/tmp/ground",
      source: "Pandoks/skills",
      management: "skills-cli",
    });
  });

  it("constructs non-interactive install, update, and remove commands", async () => {
    const fake = await makeFakeSkillsCli();
    const cli = new SkillsCli(fake.binary);
    await cli.install({
      cwd: "/tmp",
      scope: "project",
      package: "Pandoks/skills",
      skills: ["ground"],
      agents: ["codex"],
      installMode: "copy",
    });
    await cli.update({ cwd: "/tmp", scope: "global", skills: ["ground"] });
    await cli.remove({ cwd: "/tmp", scope: "global", skills: ["ground"], agents: ["codex"] });
    const commands = await readFile(fake.log, "utf8");
    expect(commands).toContain("add Pandoks/skills --skill ground --agent codex --copy --yes");
    expect(commands).toContain("update ground --global --yes");
    expect(commands).toContain("remove --skill ground --agent codex --global --yes");
  });

  it("initializes inside the selected parent without overwriting an existing target", async () => {
    const fake = await makeFakeSkillsCli();
    const parent = await mkdtemp(join(tmpdir(), "t3-skills-parent-"));
    const cli = new SkillsCli(fake.binary);
    const created = await cli.initialize({ parentDirectory: parent, name: "local-skill" });
    expect(created).toBe(join(parent, "local-skill"));
    expect(await readFile(join(created, "SKILL.md"), "utf8")).toContain("name: test");
    await mkdir(join(parent, "existing"));
    await expect(
      cli.initialize({ parentDirectory: parent, name: "existing" }),
    ).rejects.toMatchObject({ code: "target_exists" });
  });
});
