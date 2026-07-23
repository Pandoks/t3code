import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ExternalChatSource = Schema.Literals(["codex", "claude"]);
export type ExternalChatSource = typeof ExternalChatSource.Type;

export const ExternalChatCandidateId = TrimmedNonEmptyString.pipe(
  Schema.brand("ExternalChatCandidateId"),
);
export type ExternalChatCandidateId = typeof ExternalChatCandidateId.Type;

export const ExternalChatNativeSessionId = TrimmedNonEmptyString.pipe(
  Schema.brand("ExternalChatNativeSessionId"),
);
export type ExternalChatNativeSessionId = typeof ExternalChatNativeSessionId.Type;

export const ExternalChatResumability = Schema.Struct({
  status: Schema.Literals(["resumable", "not_resumable", "unknown"]),
  reason: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ExternalChatResumability = typeof ExternalChatResumability.Type;

export const ExternalChatCandidate = Schema.Struct({
  source: ExternalChatSource,
  candidateId: ExternalChatCandidateId,
  providerInstanceId: ProviderInstanceId,
  providerDisplayName: Schema.optionalKey(TrimmedNonEmptyString),
  nativeSessionId: ExternalChatNativeSessionId,
  cwd: Schema.optionalKey(TrimmedNonEmptyString),
  projectPath: Schema.optionalKey(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  preview: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  messageCount: NonNegativeInt,
  resumability: ExternalChatResumability,
  alreadyImportedThreadId: Schema.optionalKey(ThreadId),
});
export type ExternalChatCandidate = typeof ExternalChatCandidate.Type;

const HistoricalEventTimestamp = {
  timestamp: Schema.optionalKey(IsoDateTime),
} as const;

export const NormalizedHistoricalMessage = Schema.Struct({
  type: Schema.Literal("message"),
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  ...HistoricalEventTimestamp,
});

export const NormalizedHistoricalTool = Schema.Struct({
  type: Schema.Literal("tool"),
  name: TrimmedNonEmptyString,
  status: Schema.Literals(["started", "completed", "failed", "unknown"]),
  toolUseId: Schema.optionalKey(TrimmedNonEmptyString),
  summary: Schema.optionalKey(Schema.String),
  ...HistoricalEventTimestamp,
});

export const NormalizedHistoricalCommand = Schema.Struct({
  type: Schema.Literal("command"),
  command: Schema.String,
  status: Schema.Literals(["started", "completed", "failed", "unknown"]),
  toolUseId: Schema.optionalKey(TrimmedNonEmptyString),
  output: Schema.optionalKey(Schema.String),
  exitCode: Schema.optionalKey(Schema.Int),
  ...HistoricalEventTimestamp,
});

export const NormalizedHistoricalFileChange = Schema.Struct({
  type: Schema.Literal("fileChange"),
  path: Schema.optionalKey(Schema.String),
  patch: Schema.optionalKey(Schema.String),
  toolUseId: Schema.optionalKey(TrimmedNonEmptyString),
  output: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Literals(["started", "completed", "failed", "unknown"])),
  ...HistoricalEventTimestamp,
});

export const NormalizedHistoricalPlan = Schema.Struct({
  type: Schema.Literal("plan"),
  text: Schema.String,
  ...HistoricalEventTimestamp,
});

export const NormalizedHistoricalError = Schema.Struct({
  type: Schema.Literal("error"),
  message: Schema.String,
  ...HistoricalEventTimestamp,
});

export const NormalizedHistoricalTurn = Schema.Struct({
  type: Schema.Literal("turn"),
  status: Schema.Literals(["completed", "interrupted"]),
  reason: Schema.optionalKey(Schema.String),
  ...HistoricalEventTimestamp,
});

export const NormalizedHistoricalEvent = Schema.Union([
  NormalizedHistoricalMessage,
  NormalizedHistoricalTool,
  NormalizedHistoricalCommand,
  NormalizedHistoricalFileChange,
  NormalizedHistoricalPlan,
  NormalizedHistoricalError,
  NormalizedHistoricalTurn,
]);
export type NormalizedHistoricalEvent = typeof NormalizedHistoricalEvent.Type;

export const ExternalChatListRequest = Schema.Struct({
  sources: Schema.optionalKey(Schema.Array(ExternalChatSource)),
  providerInstanceIds: Schema.optionalKey(Schema.Array(ProviderInstanceId)),
});
export type ExternalChatListRequest = typeof ExternalChatListRequest.Type;

export const ExternalChatListResult = Schema.Struct({
  candidates: Schema.Array(ExternalChatCandidate),
});
export type ExternalChatListResult = typeof ExternalChatListResult.Type;

export const ExternalChatImportRequest = Schema.Struct({
  candidateIds: Schema.Array(ExternalChatCandidateId),
  projectId: Schema.optionalKey(ProjectId),
});
export type ExternalChatImportRequest = typeof ExternalChatImportRequest.Type;

export const ExternalChatImportItemResult = Schema.Struct({
  candidateId: ExternalChatCandidateId,
  threadId: Schema.optionalKey(ThreadId),
  status: Schema.Literals(["imported", "skipped", "failed"]),
  resumability: ExternalChatResumability,
  error: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ExternalChatImportItemResult = typeof ExternalChatImportItemResult.Type;

export const ExternalChatImportResult = Schema.Struct({
  results: Schema.Array(ExternalChatImportItemResult),
});
export type ExternalChatImportResult = typeof ExternalChatImportResult.Type;

export class ExternalChatRpcError extends Schema.TaggedErrorClass<ExternalChatRpcError>()(
  "ExternalChatRpcError",
  {
    operation: Schema.String,
    message: TrimmedNonEmptyString,
  },
) {}

export const ExternalChatRefreshRequest = ExternalChatListRequest;
export type ExternalChatRefreshRequest = typeof ExternalChatRefreshRequest.Type;

export const ExternalChatRefreshResult = Schema.Struct({
  candidates: Schema.Array(ExternalChatCandidate),
  refreshedAt: IsoDateTime,
});
export type ExternalChatRefreshResult = typeof ExternalChatRefreshResult.Type;
