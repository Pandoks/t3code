# Task 2 Report: Persistent external chat imports

## Status

Implemented the persistent external-chat import backend, typed RPC surface, orchestration-based history ingestion, provider-session binding, strict Codex resume, Claude cursor persistence, missing-source safeguards, and focused tests. No web UI was added.

## Red-test evidence

- Contract decoding initially failed because import requests/results did not include candidate IDs and per-item statuses.
- Strict Codex resume initially called both `thread/resume` and `thread/start`; the regression test now proves imported strict cursors call resume only.
- Persistence tests initially failed because the external-chat import repository/migration did not exist.
- Orchestration history tests initially failed because `thread.message.history.append` was unknown.
- Service tests initially failed because `ExternalChatService` did not exist, then exposed a repeated-import resumability regression that was fixed.
- RPC tests initially failed because the three `externalChats.*` methods and handlers did not exist.
- Missing-source tests initially failed because imported-source availability validation did not exist.

## Changed files

- Contracts: `packages/contracts/src/externalChats.ts`, `orchestration.ts`, `rpc.ts`, and contract tests.
- Persistence: migration 034, migration registry, repository interface/live layer, and repository tests.
- Import backend: `ExternalChatService`, `ExternalChatRpc`, WebSocket handlers/authorization, server layer wiring, and focused service/RPC tests.
- Orchestration: narrow historical-message command handling and ordering tests.
- Provider resume: strict Codex cursor behavior, Claude/native cursor persistence through the service, imported-source availability validation in `ProviderService`, and focused tests.

## Verification

- `pnpm exec vp test run packages/contracts/src/externalChats.test.ts apps/server/src/provider/Layers/CodexSessionRuntime.test.ts apps/server/src/provider/importedSourceAvailability.test.ts apps/server/src/persistence/ExternalChatImports.test.ts apps/server/src/orchestration/externalChatImport.test.ts apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatService.test.ts apps/server/src/externalChats/ExternalChatRpc.test.ts` — 8 files, 41 tests passed.
- `pnpm --filter @t3tools/contracts typecheck` — passed.
- `pnpm --dir apps/server typecheck` — passed with three existing Effect suggestions in `decider.ts` and no errors.
- `pnpm exec vp lint <22 changed source/test files>` — passed with six test-only inline-schema compile warnings in the contract test and no errors.
- Targeted `vp fmt` and `git diff --check` — passed.

## Commit

Implementation commit: `1459d0e5f0268e11d63b324d92cf06b2931e1d28`

## Self-review

- Import targets are server-configured provider homes only; the RPC accepts candidate IDs and an optional project ID, not filesystem paths.
- Provenance is isolated by provider instance and native session identity; candidate/thread uniqueness makes imports idempotent.
- History enters projections only through orchestration commands/events.
- Failure cleanup deletes provenance and the partially created thread through orchestration.
- Imported Codex bindings set `strictResume`; ordinary Codex sessions retain the existing resume-to-start fallback.
- Missing source files preserve imported history while blocking continuation with a clear validation error.

## Concerns

- No live Codex or Claude child process was exercised; strict resume and missing-source behavior are covered at the runtime/service boundary with focused tests.
