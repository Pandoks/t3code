import {
  ExternalChatCandidate,
  ExternalChatCandidateId,
  ExternalChatNativeSessionId,
  ExternalChatSource,
  IsoDateTime,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "./Errors.ts";

export const ExternalChatImportProvenance = Schema.Struct({
  source: ExternalChatSource,
  providerInstanceId: ProviderInstanceId,
  nativeSessionId: ExternalChatNativeSessionId,
  candidateId: ExternalChatCandidateId,
  threadId: ThreadId,
  sourceFingerprint: Schema.String,
  importedAt: IsoDateTime,
  schemaVersion: Schema.Int,
  candidateSnapshot: Schema.NullOr(ExternalChatCandidate),
});
export type ExternalChatImportProvenance = typeof ExternalChatImportProvenance.Type;

export interface ExternalChatNativeIdentity {
  readonly source: ExternalChatSource;
  readonly providerInstanceId: ProviderInstanceId;
  readonly nativeSessionId: ExternalChatNativeSessionId;
}

export interface ExternalChatImportRepositoryShape {
  readonly upsert: (
    provenance: ExternalChatImportProvenance,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByNativeIdentity: (
    identity: ExternalChatNativeIdentity,
  ) => Effect.Effect<Option.Option<ExternalChatImportProvenance>, ProjectionRepositoryError>;
  readonly getByCandidateId: (
    candidateId: ExternalChatCandidateId,
  ) => Effect.Effect<Option.Option<ExternalChatImportProvenance>, ProjectionRepositoryError>;
  readonly list: () => Effect.Effect<
    ReadonlyArray<ExternalChatImportProvenance>,
    ProjectionRepositoryError
  >;
  readonly deleteByThreadId: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ExternalChatImportRepository extends Context.Service<
  ExternalChatImportRepository,
  ExternalChatImportRepositoryShape
>()("t3/persistence/ExternalChatImports/ExternalChatImportRepository") {}
