import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS external_chat_imports (
      provider_instance_id TEXT NOT NULL,
      source TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      candidate_snapshot_json TEXT,
      PRIMARY KEY (provider_instance_id, source, native_session_id),
      UNIQUE (candidate_id),
      UNIQUE (thread_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_external_chat_imports_thread
    ON external_chat_imports(thread_id)
  `;
});
