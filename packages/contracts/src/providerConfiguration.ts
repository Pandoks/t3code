import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const ProviderConfigurationScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("user") }),
  Schema.Struct({ type: Schema.Literal("project"), projectId: ProjectId }),
]);
export type ProviderConfigurationScope = typeof ProviderConfigurationScope.Type;

export const ProviderConfigurationTarget = Schema.Struct({
  instanceId: ProviderInstanceId,
  scope: ProviderConfigurationScope,
});
export type ProviderConfigurationTarget = typeof ProviderConfigurationTarget.Type;

export const ProviderConfigurationSnapshotInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  scope: ProviderConfigurationScope,
});
export type ProviderConfigurationSnapshotInput = typeof ProviderConfigurationSnapshotInput.Type;

export const ProviderConfigurationCapabilities = Schema.Struct({
  settings: Schema.Boolean,
  instructions: Schema.Boolean,
  mcp: Schema.Boolean,
  skills: Schema.Boolean,
  projectScope: Schema.Boolean,
  skillInitialization: Schema.Boolean,
});

export const ProviderConfigurationResource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals(["settings", "instructions", "mcp"]),
  displayName: TrimmedNonEmptyString,
  nativePathLabel: TrimmedNonEmptyString,
  revision: TrimmedNonEmptyString,
  exists: Schema.Boolean,
  writable: Schema.Boolean,
  value: Schema.Unknown,
});
export type ProviderConfigurationResource = typeof ProviderConfigurationResource.Type;

export const ManagedProviderSkill = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  scope: Schema.Literals(["global", "project"]),
  agents: Schema.Array(TrimmedNonEmptyString),
  directory: TrimmedNonEmptyString,
  source: Schema.optionalKey(Schema.String),
  installMode: Schema.optionalKey(Schema.Literals(["copy", "symlink"])),
  management: Schema.Literals(["skills-cli", "local"]),
  updateAvailable: Schema.optionalKey(Schema.Boolean),
  validation: Schema.Literals(["valid", "invalid", "unknown"]),
});
export type ManagedProviderSkill = typeof ManagedProviderSkill.Type;

export const ProviderSkillInventory = Schema.Struct({
  available: Schema.Boolean,
  version: Schema.optionalKey(Schema.String),
  skills: Schema.Array(ManagedProviderSkill),
  issue: Schema.optionalKey(Schema.String),
});
export type ProviderSkillInventory = typeof ProviderSkillInventory.Type;

export const ProviderConfigurationIssue = Schema.Struct({
  severity: Schema.Literals(["info", "warning", "error"]),
  message: TrimmedNonEmptyString,
  resourceId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProviderConfigurationIssue = typeof ProviderConfigurationIssue.Type;

export const ProviderConfigurationSnapshot = Schema.Struct({
  target: ProviderConfigurationTarget,
  provider: ProviderDriverKind,
  capabilities: ProviderConfigurationCapabilities,
  resources: Schema.Array(ProviderConfigurationResource),
  skills: ProviderSkillInventory,
  issues: Schema.Array(ProviderConfigurationIssue),
});
export type ProviderConfigurationSnapshot = typeof ProviderConfigurationSnapshot.Type;

export const ProviderConfigurationChange = Schema.Struct({
  resourceId: TrimmedNonEmptyString,
  expectedRevision: TrimmedNonEmptyString,
  operation: Schema.Literals(["write", "delete"]),
  value: Schema.optionalKey(Schema.Unknown),
});

export const ValidateProviderConfigurationInput = Schema.Struct({
  target: ProviderConfigurationTarget,
  changes: Schema.Array(ProviderConfigurationChange),
});
export type ValidateProviderConfigurationInput = typeof ValidateProviderConfigurationInput.Type;

export const ProviderConfigurationValidationResult = Schema.Struct({
  valid: Schema.Boolean,
  issues: Schema.Array(ProviderConfigurationIssue),
});
export type ProviderConfigurationValidationResult =
  typeof ProviderConfigurationValidationResult.Type;

export const ApplyProviderConfigurationInput = ValidateProviderConfigurationInput;
export type ApplyProviderConfigurationInput = typeof ApplyProviderConfigurationInput.Type;

export const ApplyProviderConfigurationResult = Schema.Struct({
  snapshot: ProviderConfigurationSnapshot,
  backupIds: Schema.Array(TrimmedNonEmptyString),
  restartRequired: Schema.Boolean,
});
export type ApplyProviderConfigurationResult = typeof ApplyProviderConfigurationResult.Type;

const SkillListAction = Schema.Struct({ type: Schema.Literal("list") });
const SkillInstallAction = Schema.Struct({
  type: Schema.Literal("install"),
  package: TrimmedNonEmptyString,
  skills: Schema.Array(TrimmedNonEmptyString),
  agents: Schema.Array(TrimmedNonEmptyString),
  installMode: Schema.optionalKey(Schema.Literals(["copy", "symlink"])),
});
const SkillUpdateAction = Schema.Struct({
  type: Schema.Literal("update"),
  skills: Schema.Array(TrimmedNonEmptyString),
});
const SkillRemoveAction = Schema.Struct({
  type: Schema.Literal("remove"),
  skills: Schema.Array(TrimmedNonEmptyString),
  agents: Schema.Array(TrimmedNonEmptyString),
});
const SkillLinkAction = Schema.Struct({
  type: Schema.Literal("linkLocal"),
  directory: TrimmedNonEmptyString,
  agents: Schema.Array(TrimmedNonEmptyString),
  installMode: Schema.Literals(["copy", "symlink"]),
});

export const ProviderSkillAction = Schema.Union([
  SkillListAction,
  SkillInstallAction,
  SkillUpdateAction,
  SkillRemoveAction,
  SkillLinkAction,
]);
export type ProviderSkillAction = typeof ProviderSkillAction.Type;

export const ProviderSkillActionInput = Schema.Struct({
  target: ProviderConfigurationTarget,
  action: ProviderSkillAction,
});
export type ProviderSkillActionInput = typeof ProviderSkillActionInput.Type;

export const ProviderSkillActionResult = Schema.Struct({
  inventory: ProviderSkillInventory,
  output: Schema.optionalKey(Schema.String),
});
export type ProviderSkillActionResult = typeof ProviderSkillActionResult.Type;

const SkillSlug = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/));

export const InitializeProviderSkillInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  parentDirectory: TrimmedNonEmptyString,
  name: SkillSlug,
  agents: Schema.Array(TrimmedNonEmptyString),
  installMode: Schema.Literals(["copy", "symlink"]),
});
export type InitializeProviderSkillInput = typeof InitializeProviderSkillInput.Type;

export const InitializeProviderSkillResult = Schema.Struct({
  directory: TrimmedNonEmptyString,
  skill: ManagedProviderSkill,
  installed: Schema.Boolean,
  warning: Schema.optionalKey(Schema.String),
});
export type InitializeProviderSkillResult = typeof InitializeProviderSkillResult.Type;

export class ProviderConfigurationError extends Schema.TaggedErrorClass<ProviderConfigurationError>()(
  "ProviderConfigurationError",
  {
    code: Schema.Literals([
      "unsupported",
      "instance_not_found",
      "project_unavailable",
      "resource_not_found",
      "path_violation",
      "revision_conflict",
      "validation_failed",
      "permission_denied",
      "cli_unavailable",
      "cli_failed",
      "target_exists",
      "partial_initialization",
      "io_failed",
    ]),
    message: TrimmedNonEmptyString,
    resourceId: Schema.optionalKey(Schema.String),
    currentRevision: Schema.optionalKey(Schema.String),
  },
) {}
