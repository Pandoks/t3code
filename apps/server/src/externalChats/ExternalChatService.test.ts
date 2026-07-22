import {
  ExternalChatCandidateId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ExternalChatImportRepository } from "../persistence/ExternalChatImports.ts";
import { ExternalChatImportRepositoryLive } from "../persistence/Layers/ExternalChatImports.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../provider/Services/ProviderSessionDirectory.ts";
import { layerTest as serverSettingsLayerTest, ServerSettingsService } from "../serverSettings.ts";
import {
  ExternalChatService,
  ExternalChatServiceLive,
  resolveExternalChatProject,
} from "./ExternalChatService.ts";

const codexFixtureHome = new URL("./__fixtures__/codex", import.meta.url).pathname;
const claudeFixtureHome = new URL("./__fixtures__/claude", import.meta.url).pathname;
const commands: Array<OrchestrationCommand> = [];
const bindings: Array<ProviderRuntimeBinding> = [];
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

const provenanceLayer = ExternalChatImportRepositoryLive.pipe(
  Layer.provide(SqlitePersistenceMemory),
);
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
        if (failNextHistoricalDispatch && command.type === "thread.message.history.append") {
          failNextHistoricalDispatch = false;
          return Effect.die("injected historical dispatch failure");
        }
        return Effect.succeed({ sequence: commands.length });
      }),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  }),
  Layer.succeed(ProviderSessionDirectory, {
    upsert: (binding) => Effect.sync(() => bindings.push(binding)).pipe(Effect.asVoid),
    getProvider: () => Effect.die("unused"),
    getBinding: () => Effect.succeed(Option.none()),
    listThreadIds: () => Effect.succeed([]),
    listBindings: () => Effect.succeed([]),
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
      bindings.length = 0;
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
      expect(commands.filter((command) => command.type === "thread.create")).toHaveLength(1);
      expect(
        commands
          .filter((command) => command.type === "thread.message.history.append")
          .map((command) =>
            command.type === "thread.message.history.append" ? command.createdAt : "",
          ),
      ).toEqual(
        [...commands]
          .filter((command) => command.type === "thread.message.history.append")
          .map((command) =>
            command.type === "thread.message.history.append" ? command.createdAt : "",
          )
          .sort(),
      );
      expect(bindings[0]).toMatchObject({
        providerInstanceId: "codex_work",
        status: "stopped",
        resumeCursor: { threadId: "codex-session-alpha", strictResume: true },
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
        expect(commands.at(-1)?.type).toBe("thread.delete");
        expect(Option.isNone(yield* provenance.getByCandidateId(candidate.candidateId))).toBe(true);

        const imported = yield* service.import({ candidateIds: [candidate.candidateId] });
        expect(imported.results[0]?.status).toBe("imported");
        expect(bindings.at(-1)).toMatchObject({
          providerInstanceId: "claude_work",
          resumeCursor: { sessionId: "claude-session-beta" },
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
});
