// @effect-diagnostics nodeBuiltinImport:off
import {
  ExternalChatCandidateId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ExternalChatImportRepository } from "../persistence/ExternalChatImports.ts";
import type { ExternalChatImportProvenance } from "../persistence/ExternalChatImports.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { layerTest as serverSettingsLayerTest, ServerSettingsService } from "../serverSettings.ts";
import {
  ExternalChatService,
  ExternalChatServiceLive,
  resolveExternalChatProject,
} from "./ExternalChatService.ts";

const codexFixtureHome = new URL("./__fixtures__/codex", import.meta.url).pathname;
const claudeFixtureHome = new URL("./__fixtures__/claude", import.meta.url).pathname;
const commands: Array<OrchestrationCommand> = [];
const provenanceRows: Array<ExternalChatImportProvenance> = [];
let failNextHistoricalDispatch = false;

const projects = [
  {
    projectId: ProjectId.make("project-beta"),
    title: "Beta",
    workspaceRoot: "/workspace/beta",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("claude_work"),
      model: "claude-sonnet-5",
    },
    scripts: [],
    createdAt: "2026-07-20T00:00:01.500Z",
    updatedAt: "2026-07-20T00:00:01.500Z",
    deletedAt: null,
  },
  {
    projectId: ProjectId.make("project-parent"),
    title: "Parent",
    workspaceRoot: "/workspace",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    deletedAt: null,
  },
  {
    projectId: ProjectId.make("project-alpha"),
    title: "Alpha",
    workspaceRoot: "/workspace/alpha",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex_work"),
      model: "gpt-5.6-sol",
    },
    scripts: [],
    createdAt: "2026-07-20T00:00:01.000Z",
    updatedAt: "2026-07-20T00:00:01.000Z",
    deletedAt: null,
  },
  {
    projectId: ProjectId.make("project-override"),
    title: "Override",
    workspaceRoot: "/elsewhere",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-20T00:00:02.000Z",
    updatedAt: "2026-07-20T00:00:02.000Z",
    deletedAt: null,
  },
] as const;

const provenanceLayer = Layer.succeed(ExternalChatImportRepository, {
  upsert: (row) =>
    Effect.sync(() => {
      const index = provenanceRows.findIndex(
        (existing) =>
          existing.source === row.source &&
          existing.providerInstanceId === row.providerInstanceId &&
          existing.nativeSessionId === row.nativeSessionId,
      );
      if (index === -1) provenanceRows.push(row);
      else provenanceRows[index] = row;
    }),
  getByNativeIdentity: (identity) =>
    Effect.succeed(
      Option.fromNullishOr(
        provenanceRows.find(
          (row) =>
            row.source === identity.source &&
            row.providerInstanceId === identity.providerInstanceId &&
            row.nativeSessionId === identity.nativeSessionId,
        ),
      ),
    ),
  getByCandidateId: (candidateId) =>
    Effect.succeed(
      Option.fromNullishOr(provenanceRows.find((row) => row.candidateId === candidateId)),
    ),
  list: () => Effect.succeed(provenanceRows),
  deleteByThreadId: ({ threadId }) =>
    Effect.sync(() => {
      const index = provenanceRows.findIndex((row) => row.threadId === threadId);
      if (index !== -1) provenanceRows.splice(index, 1);
    }),
});
const settingsLayer = serverSettingsLayerTest({
  providerInstances: {
    [ProviderInstanceId.make("codex_work")]: {
      driver: "codex",
      config: { homePath: codexFixtureHome },
    },
    [ProviderInstanceId.make("claude_work")]: {
      driver: "claudeAgent",
      config: { homePath: claudeFixtureHome },
    },
  },
});
const serviceDependencies = Layer.mergeAll(
  provenanceLayer,
  Layer.succeed(ProjectionProjectRepository, {
    upsert: () => Effect.void,
    getById: ({ projectId }) =>
      Effect.succeed(
        Option.fromNullishOr(projects.find((project) => project.projectId === projectId)),
      ),
    listAll: () => Effect.succeed(projects),
    deleteById: () => Effect.void,
  }),
  Layer.succeed(OrchestrationEngineService, {
    dispatch: (command) =>
      Effect.suspend(() => {
        commands.push(command);
        if (failNextHistoricalDispatch && String(command.type) === "thread.external-chat.import") {
          failNextHistoricalDispatch = false;
          return Effect.die("injected historical dispatch failure");
        }
        if (String(command.type) === "thread.external-chat.import") {
          const imported = command as Extract<
            OrchestrationCommand,
            { readonly type: "thread.external-chat.import" }
          >;
          const metadata = imported.externalChat;
          const index = provenanceRows.findIndex(
            (row) =>
              row.source === metadata.source &&
              row.providerInstanceId === metadata.providerInstanceId &&
              row.nativeSessionId === metadata.nativeSessionId,
          );
          const row: ExternalChatImportProvenance = {
            source: metadata.source,
            providerInstanceId: metadata.providerInstanceId,
            nativeSessionId: metadata.nativeSessionId,
            candidateId: metadata.candidateId,
            threadId: imported.threadId,
            sourceFingerprint: metadata.sourceFingerprint,
            importedAt: metadata.importedAt,
            schemaVersion: metadata.schemaVersion,
            candidateSnapshot: metadata.candidateSnapshot,
          };
          if (index === -1) provenanceRows.push(row);
          else provenanceRows[index] = row;
        }
        return Effect.succeed({ sequence: commands.length });
      }),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  }),
  settingsLayer,
);
const testLayer = Layer.mergeAll(
  ExternalChatServiceLive.pipe(Layer.provide(serviceDependencies)),
  provenanceLayer,
  settingsLayer,
);

it("resolves exact roots before containing roots and request overrides", () => {
  expect(
    resolveExternalChatProject({
      cwd: "/workspace/alpha",
      projects,
      overrideProjectId: "project-override",
    })?.projectId,
  ).toBe("project-alpha");
  expect(
    resolveExternalChatProject({
      cwd: "/workspace/alpha/src",
      projects,
      overrideProjectId: "project-override",
    })?.projectId,
  ).toBe("project-alpha");
  expect(
    resolveExternalChatProject({ projects, overrideProjectId: "project-override" })?.projectId,
  ).toBe("project-override");
});

it.layer(testLayer)("ExternalChatService", (it) => {
  it.effect("imports in source order, persists a strict resume cursor, and is idempotent", () =>
    Effect.gen(function* () {
      commands.length = 0;
      const service = yield* ExternalChatService;
      const listed = yield* service.refresh({ sources: ["codex"] });
      const candidate = listed.candidates[0];
      if (!candidate) return yield* Effect.die("expected Codex fixture candidate");

      const first = yield* service.import({ candidateIds: [candidate.candidateId] });
      const second = yield* service.import({ candidateIds: [candidate.candidateId] });

      expect(first.results[0]?.status).toBe("imported");
      expect(second.results[0]).toMatchObject({
        status: "skipped",
        threadId: first.results[0]?.threadId,
      });
      expect(second.results[0]?.resumability).toEqual(first.results[0]?.resumability);
      const [importCommand] = commands.filter(
        (command) => String(command.type) === "thread.external-chat.import",
      ) as unknown as ReadonlyArray<{
        readonly history: ReadonlyArray<{ readonly createdAt: string }>;
        readonly externalChat: { readonly resumeCursor: unknown };
      }>;
      expect(importCommand).toBeDefined();
      expect(importCommand?.history.map((record) => record.createdAt)).toEqual(
        importCommand?.history.map((record) => record.createdAt).toSorted(),
      );
      expect(importCommand?.externalChat.resumeCursor).toEqual({
        threadId: "codex-session-alpha",
        strictResume: true,
      });
    }),
  );

  it.effect("marks imported candidates and keeps provider instance identity in provenance", () =>
    Effect.gen(function* () {
      const service = yield* ExternalChatService;
      const provenance = yield* ExternalChatImportRepository;
      const listed = yield* service.list({ sources: ["codex"] });
      const imported = listed.candidates.find((candidate) => candidate.alreadyImportedThreadId);
      expect(imported?.providerInstanceId).toBe("codex_work");
      expect(imported?.alreadyImportedThreadId).toBeDefined();
      expect(
        Option.isSome(
          yield* provenance.getByCandidateId(
            ExternalChatCandidateId.make(imported?.candidateId ?? "missing"),
          ),
        ),
      ).toBe(true);
    }),
  );

  it.effect(
    "rolls back partial history, then persists Claude resume and reports missing source",
    () =>
      Effect.gen(function* () {
        const service = yield* ExternalChatService;
        const provenance = yield* ExternalChatImportRepository;
        const settings = yield* ServerSettingsService;
        const listed = yield* service.refresh({ sources: ["claude"] });
        const candidate = listed.candidates[0];
        if (!candidate) return yield* Effect.die("expected Claude fixture candidate");

        failNextHistoricalDispatch = true;
        const failed = yield* service.import({ candidateIds: [candidate.candidateId] });
        expect(failed.results[0]?.status).toBe("failed");
        expect(Option.isNone(yield* provenance.getByCandidateId(candidate.candidateId))).toBe(true);

        const imported = yield* service.import({ candidateIds: [candidate.candidateId] });
        expect(imported.results[0]?.status).toBe("imported");
        const importCommand = commands.findLast(
          (command) => String(command.type) === "thread.external-chat.import",
        ) as unknown as { readonly externalChat: { readonly resumeCursor: unknown } };
        expect(importCommand.externalChat.resumeCursor).toEqual({
          resume: "8dcd1b39-8e74-41f0-a07c-b876917a46c4",
          resumeSessionAt: "assistant-3",
        });

        yield* settings.updateSettings({
          providerInstances: {
            [ProviderInstanceId.make("codex_work")]: {
              driver: ProviderDriverKind.make("codex"),
              config: { homePath: codexFixtureHome },
            },
            [ProviderInstanceId.make("claude_work")]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              config: { homePath: "/definitely/missing/claude-home" },
            },
          },
        });
        const missing = yield* service.list({ sources: ["claude"] });
        expect(missing.candidates[0]).toMatchObject({
          alreadyImportedThreadId: imported.results[0]?.threadId,
          resumability: {
            status: "not_resumable",
            reason: "Native source is no longer available.",
          },
        });
      }),
  );

  it.effect("scopes historical identities by provider instance", () =>
    Effect.gen(function* () {
      commands.length = 0;
      const service = yield* ExternalChatService;
      const settings = yield* ServerSettingsService;
      yield* settings.updateSettings({
        providerInstances: {
          [ProviderInstanceId.make("codex_isolated_a")]: {
            driver: ProviderDriverKind.make("codex"),
            config: { homePath: codexFixtureHome },
          },
          [ProviderInstanceId.make("codex_isolated_b")]: {
            driver: ProviderDriverKind.make("codex"),
            config: { homePath: codexFixtureHome },
          },
        },
      });
      const listed = yield* service.refresh({ sources: ["codex"] });
      const isolatedCandidates = listed.candidates.filter((candidate) =>
        candidate.providerInstanceId.startsWith("codex_isolated_"),
      );
      expect(isolatedCandidates).toHaveLength(2);
      const imported = yield* service.import({
        candidateIds: isolatedCandidates.map((candidate) => candidate.candidateId),
      });
      expect(imported.results.map((result) => result.status)).toEqual(["imported", "imported"]);

      const importCommands = commands.filter(
        (command) => String(command.type) === "thread.external-chat.import",
      ) as unknown as ReadonlyArray<{
        readonly history: ReadonlyArray<{
          readonly eventId: string;
          readonly messageId?: string;
          readonly activity?: { readonly id: string };
        }>;
      }>;
      expect(importCommands).toHaveLength(2);
      const identities = importCommands.map((command) =>
        command.history.flatMap((record) => [
          record.eventId,
          ...(record.messageId ? [record.messageId] : []),
          ...(record.activity ? [record.activity.id] : []),
        ]),
      );
      expect(identities[0]?.some((identity) => identities[1]?.includes(identity))).toBe(false);
    }),
  );

  it.effect("returns a per-item failure when one cached source disappears", () =>
    Effect.acquireUseRelease(
      Effect.tryPromise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-import-batch-"))),
      (temporaryRoot) =>
        Effect.gen(function* () {
          const codexHome = NodePath.join(temporaryRoot, "codex");
          const claudeHome = NodePath.join(temporaryRoot, "claude");
          yield* Effect.tryPromise(() =>
            NodeFSP.cp(codexFixtureHome, codexHome, { recursive: true }),
          );
          yield* Effect.tryPromise(() =>
            NodeFSP.cp(claudeFixtureHome, claudeHome, { recursive: true }),
          );
          const settings = yield* ServerSettingsService;
          yield* settings.updateSettings({
            providerInstances: {
              [ProviderInstanceId.make("codex_batch")]: {
                driver: ProviderDriverKind.make("codex"),
                config: { homePath: codexHome },
              },
              [ProviderInstanceId.make("claude_batch")]: {
                driver: ProviderDriverKind.make("claudeAgent"),
                config: { homePath: claudeHome },
              },
            },
          });
          const service = yield* ExternalChatService;
          const listed = yield* service.refresh({});
          const codex = listed.candidates.find((candidate) => candidate.source === "codex");
          const claude = listed.candidates.find((candidate) => candidate.source === "claude");
          if (!codex || !claude) return yield* Effect.die("expected copied candidates");
          yield* Effect.tryPromise(() =>
            NodeFSP.unlink(
              NodePath.join(codexHome, "sessions", "2026", "07", "20", "rollout-alpha.jsonl"),
            ),
          );

          const result = yield* service.import({
            candidateIds: [codex.candidateId, claude.candidateId],
          });
          expect(result.results.map((item) => item.status)).toEqual(["failed", "imported"]);
        }),
      (temporaryRoot) => Effect.promise(() => NodeFSP.rm(temporaryRoot, { recursive: true })),
    ),
  );
});
