// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  ExternalChatCandidateId,
  ExternalChatRpcError,
  MessageId,
  ProviderDriverKind,
  ThreadId,
  type ExternalChatCandidate,
  type ExternalChatImportRequest,
  type ExternalChatImportResult,
  type ExternalChatListRequest,
  type ExternalChatListResult,
  type ExternalChatRefreshRequest,
  type ExternalChatRefreshResult,
  type NormalizedHistoricalEvent,
  type OrchestrationCommand,
  type ProjectId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { expandHomePath } from "../pathExpansion.ts";
import { ExternalChatImportRepository } from "../persistence/ExternalChatImports.ts";
import type { ProjectionProject } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  scanExternalChats,
  type NativeExternalChat,
  type ExternalChatSourceConfig,
} from "./ExternalChatCatalog.ts";

const IMPORT_SCHEMA_VERSION = 1;
const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");

const stableId = (prefix: string, ...parts: ReadonlyArray<string>) =>
  `${prefix}-${NodeCrypto.createHash("sha256").update(parts.join("\0")).digest("hex")}`;

const normalizePath = (value: string) => NodePath.resolve(expandHomePath(value.trim()));

const containsPath = (root: string, candidate: string) => {
  const relative = NodePath.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

export function resolveExternalChatProject(input: {
  readonly cwd?: string;
  readonly projects: ReadonlyArray<ProjectionProject>;
  readonly overrideProjectId?: ProjectId | string;
}): ProjectionProject | undefined {
  const active = input.projects.filter((project) => project.deletedAt === null);
  if (input.cwd !== undefined) {
    const cwd = normalizePath(input.cwd);
    const exact = active.find((project) => normalizePath(project.workspaceRoot) === cwd);
    if (exact) return exact;
    const containing = active
      .filter((project) => containsPath(normalizePath(project.workspaceRoot), cwd))
      .toSorted(
        (left, right) =>
          normalizePath(right.workspaceRoot).length - normalizePath(left.workspaceRoot).length,
      )[0];
    if (containing) return containing;
  }
  return input.overrideProjectId === undefined
    ? undefined
    : active.find((project) => project.projectId === input.overrideProjectId);
}

const homePathFromConfig = (config: unknown, fallback: string) => {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return normalizePath(fallback);
  }
  const homePath = "homePath" in config ? config.homePath : undefined;
  return typeof homePath === "string" && homePath.trim().length > 0
    ? normalizePath(homePath)
    : normalizePath(fallback);
};

const sourceConfigs = Effect.fn("ExternalChatService.sourceConfigs")(function* (
  settings: ServerSettingsService["Service"],
  request: ExternalChatListRequest,
) {
  const current = yield* settings.getSettings;
  const requestedSources = new Set(request.sources ?? ["codex", "claude"]);
  const requestedInstances = request.providerInstanceIds
    ? new Set<string>(request.providerInstanceIds)
    : undefined;
  const sources: Array<ExternalChatSourceConfig> = [];
  for (const [rawInstanceId, instance] of Object.entries(current.providerInstances)) {
    const source =
      instance.driver === CODEX ? "codex" : instance.driver === CLAUDE ? "claude" : null;
    if (source === null || !requestedSources.has(source)) continue;
    if (requestedInstances && !requestedInstances.has(rawInstanceId)) continue;
    sources.push({
      source,
      providerInstanceId: rawInstanceId as ProviderInstanceId,
      ...(instance.displayName ? { providerDisplayName: instance.displayName } : {}),
      homeRoot: homePathFromConfig(instance.config, source === "codex" ? "~/.codex" : "~/.claude"),
    });
  }
  for (const fallback of [
    {
      source: "codex" as const,
      instanceId: "codex",
      config: current.providers.codex,
      homeRoot: "~/.codex",
    },
    {
      source: "claude" as const,
      instanceId: "claudeAgent",
      config: current.providers.claudeAgent,
      homeRoot: "~/.claude",
    },
  ]) {
    if (sources.some((source) => source.source === fallback.source)) continue;
    if (!requestedSources.has(fallback.source)) continue;
    if (requestedInstances && !requestedInstances.has(fallback.instanceId)) continue;
    sources.push({
      source: fallback.source,
      providerInstanceId: fallback.instanceId as ProviderInstanceId,
      homeRoot: homePathFromConfig(fallback.config, fallback.homeRoot),
    });
  }
  return sources;
});

const resumabilityForPresence = (candidate: ExternalChatCandidate, present: boolean) =>
  present
    ? candidate.resumability
    : { status: "not_resumable" as const, reason: "Native source is no longer available." };

function activityFromHistoricalEvent(
  event: Exclude<NormalizedHistoricalEvent, { readonly type: "message" }>,
  createdAt: string,
  activityId: string,
) {
  switch (event.type) {
    case "tool":
      return {
        id: EventId.make(activityId),
        tone: "tool" as const,
        kind: `external.tool.${event.status}`,
        summary: event.summary?.trim() || event.name,
        payload: event,
        turnId: null,
        createdAt,
      };
    case "command":
      return {
        id: EventId.make(activityId),
        tone: event.status === "failed" ? ("error" as const) : ("tool" as const),
        kind: `external.command.${event.status}`,
        summary: event.command.trim() || "Historical command",
        payload: event,
        turnId: null,
        createdAt,
      };
    case "fileChange":
      return {
        id: EventId.make(activityId),
        tone: "tool" as const,
        kind: "external.file-change",
        summary: event.path?.trim() || "Historical file change",
        payload: event,
        turnId: null,
        createdAt,
      };
    case "plan":
      return {
        id: EventId.make(activityId),
        tone: "info" as const,
        kind: "external.plan",
        summary: event.text.trim().split(/\r?\n/u)[0] || "Historical plan",
        payload: event,
        turnId: null,
        createdAt,
      };
    case "error":
      return {
        id: EventId.make(activityId),
        tone: "error" as const,
        kind: "external.error",
        summary: event.message.trim() || "Historical error",
        payload: event,
        turnId: null,
        createdAt,
      };
    case "turn":
      return {
        id: EventId.make(activityId),
        tone: "info" as const,
        kind: `external.turn.${event.status}`,
        summary: event.reason?.trim() || `Historical turn ${event.status}`,
        payload: event,
        turnId: null,
        createdAt,
      };
  }
}

export interface ExternalChatServiceShape {
  readonly list: (
    request: ExternalChatListRequest,
  ) => Effect.Effect<ExternalChatListResult, ExternalChatRpcError>;
  readonly refresh: (
    request: ExternalChatRefreshRequest,
  ) => Effect.Effect<ExternalChatRefreshResult, ExternalChatRpcError>;
  readonly import: (
    request: ExternalChatImportRequest,
  ) => Effect.Effect<ExternalChatImportResult, ExternalChatRpcError>;
}

const unavailable = (operation: string) =>
  Effect.fail(
    new ExternalChatRpcError({
      operation,
      message: "External chat import service is unavailable.",
    }),
  );

export class ExternalChatService extends Context.Reference<ExternalChatServiceShape>(
  "t3/externalChats/ExternalChatService",
  {
    defaultValue: () => ({
      list: () => unavailable("externalChats.list"),
      refresh: () => unavailable("externalChats.refresh"),
      import: () => unavailable("externalChats.import"),
    }),
  },
) {}

const make = Effect.gen(function* () {
  const imports = yield* ExternalChatImportRepository;
  const projects = yield* ProjectionProjectRepository;
  const engine = yield* OrchestrationEngineService;
  const settings = yield* ServerSettingsService;
  const cache = yield* Ref.make(new Map<string, NativeExternalChat>());

  const scan = Effect.fn("ExternalChatService.scan")(function* (request: ExternalChatListRequest) {
    const configs = yield* sourceConfigs(settings, request);
    const native = yield* scanExternalChats({ sources: configs });
    const nextCache = new Map(native.map((chat) => [chat.candidate.candidateId, chat]));
    yield* Ref.set(cache, nextCache);
    const provenance = yield* imports.list();
    const byIdentity = new Map(
      provenance.map((row) => [
        `${row.source}\0${row.providerInstanceId}\0${row.nativeSessionId}`,
        row,
      ]),
    );
    const candidates = native.map(({ candidate }) => {
      const imported = byIdentity.get(
        `${candidate.source}\0${candidate.providerInstanceId}\0${candidate.nativeSessionId}`,
      );
      return imported ? { ...candidate, alreadyImportedThreadId: imported.threadId } : candidate;
    });
    const presentIds = new Set(candidates.map((candidate) => candidate.candidateId));
    for (const row of provenance) {
      if (row.candidateSnapshot === null || presentIds.has(row.candidateId)) continue;
      if (request.sources && !request.sources.includes(row.source)) continue;
      if (
        request.providerInstanceIds &&
        !request.providerInstanceIds.includes(row.providerInstanceId)
      )
        continue;
      candidates.push({
        ...row.candidateSnapshot,
        alreadyImportedThreadId: row.threadId,
        resumability: resumabilityForPresence(row.candidateSnapshot, false),
      });
    }
    return candidates.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  });

  const list: ExternalChatServiceShape["list"] = (request) =>
    scan(request).pipe(
      Effect.map((candidates) => ({ candidates })),
      Effect.mapError(
        (cause) =>
          new ExternalChatRpcError({
            operation: "externalChats.list",
            message: cause instanceof Error ? cause.message : "Failed to list external chats.",
          }),
      ),
    );

  const refresh: ExternalChatServiceShape["refresh"] = (request) =>
    scan(request).pipe(
      Effect.flatMap((candidates) =>
        Effect.map(DateTime.now, (now) => ({
          candidates,
          refreshedAt: DateTime.formatIso(now),
        })),
      ),
      Effect.mapError(
        (cause) =>
          new ExternalChatRpcError({
            operation: "externalChats.refresh",
            message: cause instanceof Error ? cause.message : "Failed to refresh external chats.",
          }),
      ),
    );

  const importOne = Effect.fn("ExternalChatService.importOne")(function* (
    candidateId: ExternalChatCandidateId,
    overrideProjectId: ProjectId | undefined,
  ) {
    const cached = yield* Ref.get(cache);
    const existing = yield* imports.getByCandidateId(candidateId);
    if (Option.isSome(existing)) {
      const candidate = cached.get(candidateId)?.candidate ?? existing.value.candidateSnapshot;
      return {
        candidateId,
        threadId: existing.value.threadId,
        status: "skipped" as const,
        resumability:
          candidate === null
            ? { status: "unknown" as const, reason: "Imported source metadata is unavailable." }
            : resumabilityForPresence(candidate, cached.has(candidateId)),
      };
    }

    const native = cached.get(candidateId);
    if (!native) {
      return {
        candidateId,
        status: "failed" as const,
        resumability: { status: "not_resumable" as const, reason: "Native source is unavailable." },
        error: "External chat candidate is unavailable; refresh and try again.",
      };
    }

    if (native.candidate.resumability.status === "not_resumable") {
      return {
        candidateId,
        status: "failed" as const,
        resumability: native.candidate.resumability,
        error:
          native.candidate.resumability.reason ??
          "This native session cannot be resumed by its provider runtime.",
      };
    }

    const allProjects = yield* projects.listAll();
    const project = resolveExternalChatProject({
      ...(native.candidate.cwd ? { cwd: native.candidate.cwd } : {}),
      projects: allProjects,
      ...(overrideProjectId ? { overrideProjectId } : {}),
    });
    if (!project) {
      return {
        candidateId,
        status: "failed" as const,
        resumability: native.candidate.resumability,
        error: "No T3 project matches the native working directory.",
      };
    }

    const candidate = native.candidate;
    const driver = candidate.source === "codex" ? CODEX : CLAUDE;
    const modelSelection =
      project.defaultModelSelection?.instanceId === candidate.providerInstanceId
        ? project.defaultModelSelection
        : {
            instanceId: candidate.providerInstanceId,
            model: DEFAULT_MODEL_BY_PROVIDER[driver] ?? "default",
          };
    const threadId = ThreadId.make(
      stableId(
        "external",
        candidate.source,
        candidate.providerInstanceId,
        candidate.nativeSessionId,
      ),
    );
    const runImport = Effect.gen(function* () {
      const fingerprint = yield* Effect.tryPromise({
        try: () => NodeFSP.readFile(native.sourceFile),
        catch: () =>
          new ExternalChatRpcError({
            operation: "externalChats.import.readSource",
            message: "Native source is no longer available.",
          }),
      }).pipe(
        Effect.map(
          (contents) => `sha256:${NodeCrypto.createHash("sha256").update(contents).digest("hex")}`,
        ),
      );
      const importedAt = DateTime.formatIso(yield* DateTime.now);
      const resumeCursor =
        candidate.source === "codex"
          ? { threadId: candidate.nativeSessionId, strictResume: true }
          : {
              resume: candidate.nativeSessionId,
              ...(native.lastAssistantUuid ? { resumeSessionAt: native.lastAssistantUuid } : {}),
            };
      const identityScope = [
        candidate.source,
        candidate.providerInstanceId,
        candidate.nativeSessionId,
      ] as const;
      const history = native.events.map((event, index) => {
        const recordIdentity = String(index);
        const createdAt = event.timestamp ?? candidate.createdAt;
        const eventId = EventId.make(stableId("external-event", ...identityScope, recordIdentity));
        return event.type === "message"
          ? {
              type: "message" as const,
              eventId,
              messageId: MessageId.make(
                stableId("external-message", ...identityScope, recordIdentity),
              ),
              role: event.role,
              text: event.text,
              createdAt,
            }
          : {
              type: "activity" as const,
              eventId,
              activity: activityFromHistoricalEvent(
                event,
                createdAt,
                stableId("external-activity", ...identityScope, recordIdentity),
              ),
              createdAt,
            };
      });
      const command: OrchestrationCommand = {
        type: "thread.external-chat.import",
        commandId: CommandId.make(stableId("external-command", ...identityScope, "import")),
        threadId,
        projectId: project.projectId,
        title: candidate.title,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath:
          candidate.cwd && normalizePath(candidate.cwd) !== normalizePath(project.workspaceRoot)
            ? candidate.cwd
            : null,
        createdAt: candidate.createdAt,
        createEventId: EventId.make(stableId("external-event", ...identityScope, "thread")),
        history,
        sessionEventId: EventId.make(stableId("external-event", ...identityScope, "session")),
        session: {
          threadId,
          status: "stopped",
          providerName: driver,
          providerInstanceId: candidate.providerInstanceId,
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: importedAt,
        },
        externalChat: {
          source: candidate.source,
          providerInstanceId: candidate.providerInstanceId,
          nativeSessionId: candidate.nativeSessionId,
          candidateId,
          sourceFingerprint: fingerprint,
          importedAt,
          schemaVersion: IMPORT_SCHEMA_VERSION,
          candidateSnapshot: candidate,
          sourceFile: native.sourceFile,
          cwd: candidate.cwd ?? null,
          modelSelection,
          runtimeMode: "full-access",
          resumeCursor,
        },
      };
      yield* engine.dispatch(command);
      return {
        candidateId,
        threadId,
        status: "imported" as const,
        resumability: candidate.resumability,
      };
    });

    return yield* runImport.pipe(
      Effect.catchCause((cause) =>
        Effect.succeed({
          candidateId,
          status: "failed" as const,
          resumability: candidate.resumability,
          error: Cause.pretty(cause),
        }),
      ),
    );
  });

  const importCandidates: ExternalChatServiceShape["import"] = (request) =>
    Effect.forEach(request.candidateIds, (candidateId) =>
      importOne(candidateId, request.projectId),
    ).pipe(
      Effect.map((results) => ({ results })),
      Effect.mapError(
        (cause) =>
          new ExternalChatRpcError({
            operation: "externalChats.import",
            message: cause instanceof Error ? cause.message : "Failed to import external chats.",
          }),
      ),
    );

  return { list, refresh, import: importCandidates } satisfies ExternalChatServiceShape;
});

export const ExternalChatServiceLive = Layer.effect(ExternalChatService, make);
