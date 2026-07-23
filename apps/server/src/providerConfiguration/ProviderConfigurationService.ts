// @effect-diagnostics nodeBuiltinImport:off runEffectInsideEffect:off - Native Promise adapter captures initialized Effect services.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ClaudeSettings,
  CodexSettings,
  defaultInstanceIdForDriver,
  ProviderConfigurationError,
  ProviderDriverKind,
  type ApplyProviderConfigurationInput,
  type InitializeProviderSkillInput,
  type ProviderConfigurationSnapshotInput,
  type ProviderSkillActionInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeProviderConfigurationManager } from "./ProviderConfigurationManager.ts";
import { SkillsCli } from "./SkillsCli.ts";

const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);
const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);

export interface ProviderConfigurationServiceShape {
  readonly getSnapshot: ReturnType<typeof makeProviderConfigurationManager>["getSnapshot"];
  readonly validateDraft: ReturnType<typeof makeProviderConfigurationManager>["validateDraft"];
  readonly applyDraft: ReturnType<typeof makeProviderConfigurationManager>["applyDraft"];
  readonly runSkillAction: ReturnType<typeof makeProviderConfigurationManager>["runSkillAction"];
  readonly initializeSkill: ReturnType<typeof makeProviderConfigurationManager>["initializeSkill"];
}

export class ProviderConfigurationService extends Context.Service<
  ProviderConfigurationService,
  {
    readonly getSnapshot: (
      input: ProviderConfigurationSnapshotInput,
    ) => Effect.Effect<
      Awaited<ReturnType<ProviderConfigurationServiceShape["getSnapshot"]>>,
      ProviderConfigurationError
    >;
    readonly validateDraft: (
      input: ApplyProviderConfigurationInput,
    ) => Effect.Effect<
      Awaited<ReturnType<ProviderConfigurationServiceShape["validateDraft"]>>,
      ProviderConfigurationError
    >;
    readonly applyDraft: (
      input: ApplyProviderConfigurationInput,
    ) => Effect.Effect<
      Awaited<ReturnType<ProviderConfigurationServiceShape["applyDraft"]>>,
      ProviderConfigurationError
    >;
    readonly runSkillAction: (
      input: ProviderSkillActionInput,
    ) => Effect.Effect<
      Awaited<ReturnType<ProviderConfigurationServiceShape["runSkillAction"]>>,
      ProviderConfigurationError
    >;
    readonly initializeSkill: (
      input: InitializeProviderSkillInput,
    ) => Effect.Effect<
      Awaited<ReturnType<ProviderConfigurationServiceShape["initializeSkill"]>>,
      ProviderConfigurationError
    >;
  }
>()("t3/providerConfiguration/ProviderConfigurationService") {}

function toConfigurationError(cause: unknown): ProviderConfigurationError {
  const value = cause as {
    code?: unknown;
    message?: unknown;
    resourceId?: unknown;
    currentRevision?: unknown;
  };
  const allowed = new Set([
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
  ]);
  const code = typeof value.code === "string" && allowed.has(value.code) ? value.code : "io_failed";
  return new ProviderConfigurationError({
    code: code as ProviderConfigurationError["code"],
    message:
      typeof value.message === "string" && value.message.trim()
        ? value.message
        : "Provider configuration operation failed.",
    ...(typeof value.resourceId === "string" ? { resourceId: value.resourceId } : {}),
    ...(typeof value.currentRevision === "string"
      ? { currentRevision: value.currentRevision }
      : {}),
  });
}

export function makeProviderConfigurationService(input: {
  readonly settingsService: ServerSettingsService["Service"];
  readonly projects: ProjectionSnapshotQuery["Service"];
  readonly path: Path.Path;
}): ProviderConfigurationService["Service"] {
  const { settingsService, projects, path } = input;
  const skills = new SkillsCli();

  const resolveTarget = async (target: ProviderConfigurationSnapshotInput) => {
    const settings = await Effect.runPromise(settingsService.getSettings);
    const explicit = settings.providerInstances[target.instanceId];
    const defaultCodexId = defaultInstanceIdForDriver(ProviderDriverKind.make("codex"));
    const defaultClaudeId = defaultInstanceIdForDriver(ProviderDriverKind.make("claudeAgent"));
    const driver =
      explicit?.driver ??
      (target.instanceId === defaultCodexId
        ? ProviderDriverKind.make("codex")
        : target.instanceId === defaultClaudeId
          ? ProviderDriverKind.make("claudeAgent")
          : undefined);
    if (driver !== "codex" && driver !== "claudeAgent") {
      throw Object.assign(
        new Error(
          `Provider instance '${target.instanceId}' does not support configuration management.`,
        ),
        {
          code: explicit ? "unsupported" : "instance_not_found",
        },
      );
    }

    let root: string;
    if (target.scope.type === "project") {
      const project = await Effect.runPromise(projects.getProjectShellById(target.scope.projectId));
      if (Option.isNone(project)) {
        throw Object.assign(new Error(`Project '${target.scope.projectId}' is unavailable.`), {
          code: "project_unavailable",
        });
      }
      root = project.value.workspaceRoot;
    } else if (driver === "codex") {
      const config = await Effect.runPromise(
        decodeCodexSettings(explicit?.config ?? settings.providers.codex),
      );
      const layout = await Effect.runPromise(
        resolveCodexHomeLayout(config).pipe(Effect.provideService(Path.Path, path)),
      );
      root = layout.effectiveHomePath ?? layout.sharedHomePath;
    } else {
      const config = await Effect.runPromise(
        decodeClaudeSettings(explicit?.config ?? settings.providers.claudeAgent),
      );
      const resolved = await Effect.runPromise(
        resolveClaudeHomePath(config).pipe(Effect.provideService(Path.Path, path)),
      );
      root = config.homePath.trim() ? resolved : NodePath.join(NodeOS.homedir(), ".claude");
    }
    return {
      provider: String(driver) as "codex" | "claudeAgent",
      root,
      cwd: target.scope.type === "project" ? root : NodeOS.homedir(),
    } as const;
  };

  const manager = makeProviderConfigurationManager({ resolveTarget, skills });
  const wrap = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: toConfigurationError });

  return ProviderConfigurationService.of({
    getSnapshot: (request) => wrap(() => manager.getSnapshot(request)),
    validateDraft: (request) => wrap(() => manager.validateDraft(request)),
    applyDraft: (request) => wrap(() => manager.applyDraft(request)),
    runSkillAction: (request) => wrap(() => manager.runSkillAction(request)),
    initializeSkill: (request) => wrap(() => manager.initializeSkill(request)),
  });
}

export const layer = Layer.effect(
  ProviderConfigurationService,
  Effect.gen(function* () {
    const settingsService = yield* ServerSettingsService;
    const projects = yield* ProjectionSnapshotQuery;
    const path = yield* Path.Path;
    return makeProviderConfigurationService({ settingsService, projects, path });
  }),
);
