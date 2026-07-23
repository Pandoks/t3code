// @effect-diagnostics nodeBuiltinImport:off - Provider configuration resolves native filesystem resources.
import * as NodePath from "node:path";

import type {
  ApplyProviderConfigurationInput,
  ApplyProviderConfigurationResult,
  InitializeProviderSkillInput,
  InitializeProviderSkillResult,
  ProviderConfigurationSnapshot,
  ProviderConfigurationSnapshotInput,
  ProviderConfigurationValidationResult,
  ProviderSkillActionInput,
  ProviderSkillActionResult,
  ProviderSkillInventory,
  ProviderConfigurationIssue,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";

import {
  readClaudeConfiguration,
  readCodexConfiguration,
  serializeProviderResource,
} from "./ProviderConfigurationAdapters.ts";
import { applyConfigurationFiles } from "./ProviderConfigurationFileStore.ts";

type SupportedProvider = "codex" | "claudeAgent";

export interface ResolvedProviderConfigurationTarget {
  readonly provider: SupportedProvider;
  readonly root: string;
  readonly cwd: string;
}

interface SkillsOperations {
  probe(): Promise<{ available: boolean; version?: string }>;
  list(input: {
    cwd: string;
    scope: "global" | "project";
    agents: ReadonlyArray<string>;
  }): Promise<ProviderSkillInventory>;
  install?(input: {
    cwd: string;
    scope: "global" | "project";
    package: string;
    skills: ReadonlyArray<string>;
    agents: ReadonlyArray<string>;
    installMode?: "copy" | "symlink";
  }): Promise<void>;
  update?(input: {
    cwd: string;
    scope: "global" | "project";
    skills: ReadonlyArray<string>;
  }): Promise<void>;
  remove?(input: {
    cwd: string;
    scope: "global" | "project";
    skills: ReadonlyArray<string>;
    agents: ReadonlyArray<string>;
  }): Promise<void>;
  initialize?(input: { parentDirectory: string; name: string }): Promise<string>;
}

export function makeProviderConfigurationManager(input: {
  readonly resolveTarget: (
    target: ProviderConfigurationSnapshotInput,
  ) => Promise<ResolvedProviderConfigurationTarget>;
  readonly skills: SkillsOperations;
}) {
  const getSnapshot = async (
    target: ProviderConfigurationSnapshotInput,
  ): Promise<ProviderConfigurationSnapshot> => {
    const resolved = await input.resolveTarget(target);
    const scope = target.scope.type;
    const native =
      resolved.provider === "codex"
        ? await readCodexConfiguration({ root: resolved.root, scope })
        : await readClaudeConfiguration({ root: resolved.root, scope });
    const probe = await input.skills.probe();
    let inventory: ProviderSkillInventory = {
      available: probe.available,
      ...(probe.version ? { version: probe.version } : {}),
      skills: [],
    };
    if (probe.available) {
      try {
        inventory = {
          ...(await input.skills.list({
            cwd: resolved.cwd,
            scope: scope === "user" ? "global" : "project",
            agents: [resolved.provider === "claudeAgent" ? "claude-code" : "codex"],
          })),
          ...(probe.version ? { version: probe.version } : {}),
        };
      } catch (error) {
        inventory = {
          available: false,
          skills: [],
          issue: error instanceof Error ? error.message : "Could not read installed skills.",
        };
      }
    }
    return {
      target,
      provider: ProviderDriverKind.make(resolved.provider),
      capabilities: {
        settings: true,
        instructions: true,
        mcp: true,
        skills: probe.available,
        projectScope: true,
        skillInitialization: probe.available,
      },
      resources: [...native.resources],
      skills: inventory,
      issues: [...native.issues],
    };
  };

  const validateDraft = async (
    draft: ApplyProviderConfigurationInput,
  ): Promise<ProviderConfigurationValidationResult> => {
    const snapshot = await getSnapshot(draft.target);
    const issues: ProviderConfigurationIssue[] = [];
    const resources = new Map(snapshot.resources.map((resource) => [resource.id, resource]));
    for (const change of draft.changes) {
      const resource = resources.get(change.resourceId);
      if (!resource) {
        issues.push({
          severity: "error",
          resourceId: change.resourceId,
          message: "Unknown configuration resource.",
        });
        continue;
      }
      if (resource.revision !== change.expectedRevision) {
        issues.push({
          severity: "error",
          resourceId: change.resourceId,
          message: "This resource changed outside T3Code. Reload before applying.",
        });
        continue;
      }
      if (change.operation === "write") {
        try {
          serializeProviderResource({
            provider: snapshot.provider as SupportedProvider,
            resourceId: change.resourceId,
            value: change.value,
          });
        } catch (error) {
          issues.push({
            severity: "error",
            resourceId: change.resourceId,
            message: error instanceof Error ? error.message : "Invalid configuration value.",
          });
        }
      }
    }
    return { valid: issues.length === 0, issues };
  };

  const applyDraft = async (
    draft: ApplyProviderConfigurationInput,
  ): Promise<ApplyProviderConfigurationResult> => {
    const validation = await validateDraft(draft);
    if (!validation.valid) {
      throw Object.assign(new Error("Configuration draft validation failed."), {
        code: "validation_failed" as const,
      });
    }
    const resolved = await input.resolveTarget(draft.target);
    const before = await getSnapshot(draft.target);
    const resources = new Map(before.resources.map((resource) => [resource.id, resource]));
    const writeResult = await applyConfigurationFiles(
      resolved.root,
      draft.changes.map((change) => {
        const resource = resources.get(change.resourceId)!;
        return {
          relativePath: resource.nativePathLabel,
          expectedRevision: change.expectedRevision,
          operation: change.operation,
          ...(change.operation === "write"
            ? {
                contents: serializeProviderResource({
                  provider: resolved.provider,
                  resourceId: change.resourceId,
                  value: change.value,
                }),
              }
            : {}),
        };
      }),
    );
    return {
      snapshot: await getSnapshot(draft.target),
      backupIds: writeResult.backups.map((backup) => NodePath.basename(backup)),
      restartRequired: draft.changes.length > 0,
    };
  };

  const runSkillAction = async (
    request: ProviderSkillActionInput,
  ): Promise<ProviderSkillActionResult> => {
    const resolved = await input.resolveTarget(request.target);
    const scope = request.target.scope.type === "user" ? "global" : "project";
    const action = request.action;
    if (action.type === "install") {
      if (!input.skills.install) throw new Error("Skill installation is unavailable.");
      await input.skills.install({ cwd: resolved.cwd, scope, ...action });
    } else if (action.type === "update") {
      if (!input.skills.update) throw new Error("Skill updates are unavailable.");
      await input.skills.update({ cwd: resolved.cwd, scope, skills: action.skills });
    } else if (action.type === "remove") {
      if (!input.skills.remove) throw new Error("Skill removal is unavailable.");
      await input.skills.remove({
        cwd: resolved.cwd,
        scope,
        skills: action.skills,
        agents: action.agents,
      });
    } else if (action.type === "linkLocal") {
      if (!input.skills.install) throw new Error("Local skill installation is unavailable.");
      await input.skills.install({
        cwd: resolved.cwd,
        scope,
        package: action.directory,
        skills: ["*"],
        agents: action.agents,
        installMode: action.installMode,
      });
    }
    const snapshot = await getSnapshot(request.target);
    return { inventory: snapshot.skills };
  };

  const initializeSkill = async (
    request: InitializeProviderSkillInput,
  ): Promise<InitializeProviderSkillResult> => {
    if (!input.skills.initialize) throw new Error("Skill initialization is unavailable.");
    const directory = await input.skills.initialize({
      parentDirectory: request.parentDirectory,
      name: request.name,
    });
    return {
      directory,
      installed: false,
      skill: {
        id: `local:${directory}`,
        name: request.name,
        scope: "project",
        agents: [...request.agents],
        directory,
        installMode: request.installMode,
        management: "local",
        validation: "valid",
      },
    };
  };

  return { getSnapshot, validateDraft, applyDraft, runSkillAction, initializeSkill };
}

export type ProviderConfigurationManager = ReturnType<typeof makeProviderConfigurationManager>;
