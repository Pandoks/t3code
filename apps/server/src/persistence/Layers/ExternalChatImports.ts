import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ExternalChatImportProvenance,
  ExternalChatImportRepository,
  type ExternalChatImportRepositoryShape,
} from "../ExternalChatImports.ts";

interface RawRow {
  readonly source: unknown;
  readonly providerInstanceId: unknown;
  readonly nativeSessionId: unknown;
  readonly candidateId: unknown;
  readonly threadId: unknown;
  readonly sourceFingerprint: unknown;
  readonly importedAt: unknown;
  readonly schemaVersion: unknown;
  readonly candidateSnapshotJson: unknown;
}

const decodeProvenance = Schema.decodeUnknownEffect(ExternalChatImportProvenance);

const decodeRow = (row: RawRow) =>
  decodeProvenance({
    source: row.source,
    providerInstanceId: row.providerInstanceId,
    nativeSessionId: row.nativeSessionId,
    candidateId: row.candidateId,
    threadId: row.threadId,
    sourceFingerprint: row.sourceFingerprint,
    importedAt: row.importedAt,
    schemaVersion: row.schemaVersion,
    candidateSnapshot:
      typeof row.candidateSnapshotJson === "string" ? JSON.parse(row.candidateSnapshotJson) : null,
  }).pipe(Effect.mapError(toPersistenceDecodeError("ExternalChatImportRepository.decodeRow")));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectColumns = sql`
    source,
    provider_instance_id AS "providerInstanceId",
    native_session_id AS "nativeSessionId",
    candidate_id AS "candidateId",
    thread_id AS "threadId",
    source_fingerprint AS "sourceFingerprint",
    imported_at AS "importedAt",
    schema_version AS "schemaVersion",
    candidate_snapshot_json AS "candidateSnapshotJson"
  `;

  const upsert: ExternalChatImportRepositoryShape["upsert"] = (row) =>
    sql`
      INSERT INTO external_chat_imports (
        provider_instance_id, source, native_session_id, candidate_id, thread_id,
        source_fingerprint, imported_at, schema_version, candidate_snapshot_json
      ) VALUES (
        ${row.providerInstanceId}, ${row.source}, ${row.nativeSessionId}, ${row.candidateId},
        ${row.threadId}, ${row.sourceFingerprint}, ${row.importedAt}, ${row.schemaVersion},
        ${row.candidateSnapshot === null ? null : JSON.stringify(row.candidateSnapshot)}
      )
      ON CONFLICT (provider_instance_id, source, native_session_id) DO UPDATE SET
        candidate_id = excluded.candidate_id,
        thread_id = excluded.thread_id,
        source_fingerprint = excluded.source_fingerprint,
        imported_at = excluded.imported_at,
        schema_version = excluded.schema_version,
        candidate_snapshot_json = excluded.candidate_snapshot_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ExternalChatImportRepository.upsert")),
    );

  const getByNativeIdentity: ExternalChatImportRepositoryShape["getByNativeIdentity"] = (
    identity,
  ) =>
    sql<RawRow>`
      SELECT ${selectColumns}
      FROM external_chat_imports
      WHERE provider_instance_id = ${identity.providerInstanceId}
        AND source = ${identity.source}
        AND native_session_id = ${identity.nativeSessionId}
      LIMIT 1
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ExternalChatImportRepository.getByNativeIdentity")),
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none())
          : decodeRow(rows[0]).pipe(Effect.map(Option.some)),
      ),
    );

  const getByCandidateId: ExternalChatImportRepositoryShape["getByCandidateId"] = (candidateId) =>
    sql<RawRow>`
      SELECT ${selectColumns}
      FROM external_chat_imports
      WHERE candidate_id = ${candidateId}
      LIMIT 1
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ExternalChatImportRepository.getByCandidateId")),
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none())
          : decodeRow(rows[0]).pipe(Effect.map(Option.some)),
      ),
    );

  const list: ExternalChatImportRepositoryShape["list"] = () =>
    sql<RawRow>`
      SELECT ${selectColumns}
      FROM external_chat_imports
      ORDER BY imported_at ASC, candidate_id ASC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ExternalChatImportRepository.list")),
      Effect.flatMap((rows) => Effect.forEach(rows, decodeRow)),
    );

  const deleteByThreadId: ExternalChatImportRepositoryShape["deleteByThreadId"] = ({ threadId }) =>
    sql`DELETE FROM external_chat_imports WHERE thread_id = ${threadId}`.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ExternalChatImportRepository.deleteByThreadId")),
    );

  return { upsert, getByNativeIdentity, getByCandidateId, list, deleteByThreadId };
});

export const ExternalChatImportRepositoryLive = Layer.effect(ExternalChatImportRepository, make);
