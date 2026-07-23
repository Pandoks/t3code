# Final review blocker fixes

Date: 2026-07-22

## Scope

- Select title/preview text after known Codex and Claude injected wrappers while retaining ordinary user-authored markup.
- Exclude Codex native subagent transcripts for both top-level `parent_thread_id` metadata and every `source.subagent` variant.
- Preserve Codex/Claude icons while distinguishing provider instances using the configured display name or a humanized instance ID fallback.

## RED evidence

### Initial representative fixtures and UI/contract assertions

Command:

```text
pnpm exec vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatService.test.ts packages/contracts/src/externalChats.test.ts apps/web/src/components/ExternalChatImportDialog.test.tsx
```

Result: exit 1; 4 test files failed, 7 tests failed and 25 passed.

Expected failures demonstrated:

- concatenated `<recommended_plugins>` + AGENTS + environment context was used as the Codex title/preview;
- Claude `<local-command-caveat>` was used as the preview;
- Codex top-level `parent_thread_id` and `source.subagent.other=guardian` fixtures leaked into catalog results;
- `providerDisplayName` was absent from contract/service results;
- two Claude instances rendered the same generic `Claude` label.

### Native custom-title follow-up

A read-only scan of the actual native catalogs found 238 returned Codex candidates and 765 Claude candidates after subagent filtering. It found zero returned Codex subagents and zero Codex wrapper titles, but five Claude branch sessions still had auto-generated custom titles beginning with an unclosed `<local-command-caveat>`.

After adding that exact fixture, this command failed as expected:

```text
pnpm exec vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts
```

Result: exit 1; 1 test failed and 7 passed. The received title was `<local-command-caveat>Injected command title (Branch)` instead of the genuine `Add import support` prompt.

## GREEN implementation

- Added a whitelist-based leading-wrapper stripper for known injected Codex/Claude blocks. It repeatedly removes only recognized wrappers, then uses the remaining genuine text for title/preview selection.
- Added a known-injected-title-prefix guard so Claude auto-generated branch titles derived from command wrappers fall back to the genuine prompt.
- Kept ordinary markup eligible; `<request>Keep this markup</request>` remains the title and preview in its regression test.
- Added `isSubagent` metadata detection for every `source.subagent` value and top-level `parent_thread_id` detection, while preserving top-level sessions with `parent_thread_id: null` or normal sources.
- Added optional `providerDisplayName` to the candidate schema, plumbed configured provider instance names through the service/catalog, and added a humanized provider-instance fallback in the dialog without replacing provider icons or exposing raw `codex` / `claudeAgent` identifiers.

## GREEN verification

Focused catalog/service/contract/dialog tests:

```text
pnpm exec vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatService.test.ts packages/contracts/src/externalChats.test.ts apps/web/src/components/ExternalChatImportDialog.test.tsx
```

Result: exit 0; 4 files passed, 32 tests passed.

Read-only native audit (temporary test removed after the run):

```text
pnpm exec vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatCatalog.native-audit.test.ts
```

Result: exit 0; 2 files passed, 9 tests passed. Assertions confirmed zero known wrapper titles and zero returned Codex subagents across the native catalogs. Native files were only read.

Server, web, and contracts typechecks:

```text
pnpm exec vp run --filter t3 --filter @t3tools/web --filter @t3tools/contracts typecheck
```

Result: exit 0. The server emitted three pre-existing `effect(unnecessaryFailYieldableError)` suggestions in `src/orchestration/decider.ts`; no type errors.

Targeted format, lint, and diff checks:

```text
pnpm exec vp fmt --check apps/server/src/externalChats/ExternalChatCatalog.ts apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatService.ts apps/server/src/externalChats/ExternalChatService.test.ts apps/web/src/components/ExternalChatImportDialog.tsx apps/web/src/components/ExternalChatImportDialog.test.tsx packages/contracts/src/externalChats.ts packages/contracts/src/externalChats.test.ts
pnpm exec vp lint --report-unused-disable-directives apps/server/src/externalChats/ExternalChatCatalog.ts apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatService.ts apps/server/src/externalChats/ExternalChatService.test.ts apps/web/src/components/ExternalChatImportDialog.tsx apps/web/src/components/ExternalChatImportDialog.test.tsx packages/contracts/src/externalChats.ts packages/contracts/src/externalChats.test.ts
git diff --check
```

Result: all exited 0; formatting matched, lint was clean, and the diff had no whitespace errors.

## Remaining integration gate

Per repository instructions, this subagent did not launch a web dev server. The primary agent owns the single integrated `test-t3-app` verification pass for this user-visible dialog change after integrating the commit.

## Follow-up: Claude teammate-agent transcripts

The final native review found Claude teammate agents stored at the project-session level with `isSidechain: false`. Their first textual user record is an attribute-bearing envelope such as `<teammate-message teammate_id="team-lead">`, so sidechain and directory filtering alone did not identify them.

RED fixture command:

```text
pnpm exec vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts
```

Result: exit 1; 3 tests failed and 5 passed. The teammate fixture became a resumable catalog candidate titled `<teammate-message teammate_id="team-lead">`, while the expected top-level Claude session remained present.

Implementation: the Claude parser now classifies a transcript as a teammate agent only when its first textual user record begins with a `teammate-message` opening tag containing a quoted `teammate_id` attribute. The scanner excludes that transcript as a subagent. This does not classify a genuine top-level chat merely because a teammate message appears later in its history.

GREEN focused tests:

```text
pnpm exec vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatService.test.ts
```

Result: exit 0; 2 files passed, 14 tests passed.

GREEN read-only native audit:

```text
pnpm exec vp test run apps/server/src/externalChats/ExternalChatCatalog.native-audit.test.ts
```

Result: exit 0; 1 test passed. The temporary audit asserted that the actual Claude catalog returned zero titles beginning with an attribute-bearing teammate envelope; the audit file was removed after the run and native files were only read.

Follow-up static verification:

```text
pnpm exec vp run --filter t3 typecheck
pnpm exec vp fmt --check apps/server/src/externalChats/ExternalChatCatalog.ts apps/server/src/externalChats/ExternalChatCatalog.test.ts
pnpm exec vp lint --report-unused-disable-directives apps/server/src/externalChats/ExternalChatCatalog.ts apps/server/src/externalChats/ExternalChatCatalog.test.ts
git diff --check
```

Result: all exited 0. Typecheck retained the same three pre-existing suggestions in `src/orchestration/decider.ts`; no type errors.
