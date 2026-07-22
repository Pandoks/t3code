import {
  ExternalChatCandidateId,
  ExternalChatNativeSessionId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ExternalChatImportRepository } from "./ExternalChatImports.ts";
import { ExternalChatImportRepositoryLive } from "./Layers/ExternalChatImports.ts";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";

const layer = it.layer(
  ExternalChatImportRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ExternalChatImportRepository", (it) => {
  it.effect("isolates native identities by provider instance and round-trips provenance", () =>
    Effect.gen(function* () {
      const repository = yield* ExternalChatImportRepository;
      const common = {
        source: "codex" as const,
        nativeSessionId: ExternalChatNativeSessionId.make("native-session"),
        candidateId: ExternalChatCandidateId.make("extchat_v1_candidate"),
        threadId: ThreadId.make("thread-work"),
        sourceFingerprint: "sha256:abc",
        importedAt: "2026-07-21T00:00:00.000Z",
        schemaVersion: 1,
        candidateSnapshot: null,
      };

      yield* repository.upsert({
        ...common,
        providerInstanceId: ProviderInstanceId.make("codex_work"),
      });

      const work = yield* repository.getByNativeIdentity({
        source: "codex",
        providerInstanceId: ProviderInstanceId.make("codex_work"),
        nativeSessionId: ExternalChatNativeSessionId.make("native-session"),
      });
      const personal = yield* repository.getByNativeIdentity({
        source: "codex",
        providerInstanceId: ProviderInstanceId.make("codex_personal"),
        nativeSessionId: ExternalChatNativeSessionId.make("native-session"),
      });

      assert.equal(Option.getOrThrow(work).threadId, "thread-work");
      assert.isTrue(Option.isNone(personal));
    }),
  );

  it.effect("deletes provenance by thread during rollback", () =>
    Effect.gen(function* () {
      const repository = yield* ExternalChatImportRepository;
      const threadId = ThreadId.make("thread-partial");
      yield* repository.upsert({
        source: "claude",
        providerInstanceId: ProviderInstanceId.make("claude_work"),
        nativeSessionId: ExternalChatNativeSessionId.make("native-claude"),
        candidateId: ExternalChatCandidateId.make("extchat_v1_claude"),
        threadId,
        sourceFingerprint: "sha256:def",
        importedAt: "2026-07-21T00:00:00.000Z",
        schemaVersion: 1,
        candidateSnapshot: null,
      });

      yield* repository.deleteByThreadId({ threadId });
      assert.isTrue(
        Option.isNone(
          yield* repository.getByNativeIdentity({
            source: "claude",
            providerInstanceId: ProviderInstanceId.make("claude_work"),
            nativeSessionId: ExternalChatNativeSessionId.make("native-claude"),
          }),
        ),
      );
    }),
  );
});
