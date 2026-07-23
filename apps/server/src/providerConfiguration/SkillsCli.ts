// @effect-diagnostics nodeBuiltinImport:off - This module is the explicit external CLI boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import type { ManagedProviderSkill, ProviderSkillInventory } from "@t3tools/contracts";

const execFilePromise = NodeUtil.promisify(NodeChildProcess.execFile);

export class SkillsCliError extends Error {
  readonly code: "cli_unavailable" | "cli_failed" | "target_exists";

  constructor(code: SkillsCliError["code"], message: string) {
    super(message);
    this.name = "SkillsCliError";
    this.code = code;
  }
}

interface CommandOptions {
  readonly cwd: string;
}

interface ScopeOptions extends CommandOptions {
  readonly scope: "global" | "project";
}

function scopeArgs(scope: "global" | "project"): string[] {
  return scope === "global" ? ["--global"] : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeInventory(raw: unknown, scope: "global" | "project"): ProviderSkillInventory {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).skills)
      ? ((raw as Record<string, unknown>).skills as unknown[])
      : [];
  const skills: ManagedProviderSkill[] = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : null;
    const directory =
      typeof item.path === "string"
        ? item.path
        : typeof item.directory === "string"
          ? item.directory
          : null;
    if (!name || !directory) return [];
    return [
      {
        id: `${scope}:${name}:${directory}`,
        name,
        scope,
        agents: strings(item.agents),
        directory,
        ...(typeof item.description === "string" ? { description: item.description } : {}),
        ...(typeof item.source === "string" ? { source: item.source } : {}),
        management: "skills-cli" as const,
        validation: "unknown" as const,
      },
    ];
  });
  return { available: true, skills };
}

export class SkillsCli {
  private readonly executable: string;
  private readonly prefixArgs: ReadonlyArray<string>;

  constructor(
    executable = "npx",
    prefixArgs: ReadonlyArray<string> = executable === "npx" ? ["--yes", "skills"] : [],
  ) {
    this.executable = executable;
    this.prefixArgs = prefixArgs;
  }

  private async run(args: ReadonlyArray<string>, options: CommandOptions): Promise<string> {
    try {
      const result = await execFilePromise(this.executable, [...this.prefixArgs, ...args], {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
      });
      return result.stdout;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
      if (nodeError.code === "ENOENT") {
        throw new SkillsCliError("cli_unavailable", "The vercel-labs/skills CLI is unavailable.");
      }
      throw new SkillsCliError(
        "cli_failed",
        nodeError.stderr?.trim() || nodeError.message || "The skills command failed.",
      );
    }
  }

  async probe(): Promise<{ available: boolean; version?: string }> {
    try {
      const version = (await this.run(["--version"], { cwd: process.cwd() })).trim();
      return { available: true, ...(version ? { version } : {}) };
    } catch (error) {
      if (error instanceof SkillsCliError && error.code === "cli_unavailable") {
        return { available: false };
      }
      throw error;
    }
  }

  async list(
    input: ScopeOptions & { readonly agents: ReadonlyArray<string> },
  ): Promise<ProviderSkillInventory> {
    const stdout = await this.run(
      [
        "list",
        ...scopeArgs(input.scope),
        ...input.agents.flatMap((agent) => ["--agent", agent]),
        "--json",
      ],
      input,
    );
    return normalizeInventory(JSON.parse(stdout), input.scope);
  }

  async install(
    input: ScopeOptions & {
      readonly package: string;
      readonly skills: ReadonlyArray<string>;
      readonly agents: ReadonlyArray<string>;
      readonly installMode?: "copy" | "symlink";
    },
  ): Promise<void> {
    await this.run(
      [
        "add",
        input.package,
        ...input.skills.flatMap((skill) => ["--skill", skill]),
        ...input.agents.flatMap((agent) => ["--agent", agent]),
        ...(input.installMode === "copy" ? ["--copy"] : []),
        ...scopeArgs(input.scope),
        "--yes",
      ],
      input,
    );
  }

  async update(input: ScopeOptions & { readonly skills: ReadonlyArray<string> }): Promise<void> {
    await this.run(["update", ...input.skills, ...scopeArgs(input.scope), "--yes"], input);
  }

  async remove(
    input: ScopeOptions & {
      readonly skills: ReadonlyArray<string>;
      readonly agents: ReadonlyArray<string>;
    },
  ): Promise<void> {
    await this.run(
      [
        "remove",
        ...input.skills.flatMap((skill) => ["--skill", skill]),
        ...input.agents.flatMap((agent) => ["--agent", agent]),
        ...scopeArgs(input.scope),
        "--yes",
      ],
      input,
    );
  }

  async initialize(input: {
    readonly parentDirectory: string;
    readonly name: string;
  }): Promise<string> {
    const target = NodePath.join(input.parentDirectory, input.name);
    try {
      await NodeFSP.access(target);
      throw new SkillsCliError("target_exists", `Skill directory '${target}' already exists.`);
    } catch (error) {
      if (error instanceof SkillsCliError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.run(["init", input.name], { cwd: input.parentDirectory });
    return target;
  }
}
