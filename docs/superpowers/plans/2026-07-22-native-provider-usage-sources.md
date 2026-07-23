# Native Provider Usage Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incomplete interactive CLI probes with native authenticated Codex and Claude quota requests while retaining existing local-history collection and UI behavior.

**Architecture:** The server resolves credentials inside each provider instance boundary, performs bounded HTTP requests, normalizes provider payloads into the existing `ProviderUsageSnapshotDraft`, and falls back to the current CLI probe when native credentials are unavailable. Codex continues using app-server data but merges richer OAuth `wham/usage` windows. Claude uses its OAuth usage endpoint first and preserves the native `/usage` probe as a fallback. Secrets never enter contracts, logs, snapshots, or the browser.

**Tech Stack:** Effect, Node child-process/keychain access, provider OAuth HTTP APIs, Vite+ tests.

## Global Constraints

- No CodexBar runtime dependency.
- Resolve credentials separately for every configured provider instance.
- Never expose or log access tokens, cookies, credential payloads, or account identifiers.
- Preserve last-good snapshots when credential or network refreshes fail.
- Keep the existing 60-second managed refresh behavior and composer UI.

---

### Task 1: Claude OAuth usage source

**Files:**

- Create: `apps/server/src/provider/usage/claudeOAuthUsage.ts`
- Create: `apps/server/src/provider/usage/claudeOAuthUsage.test.ts`
- Modify: `apps/server/src/provider/usage/claudeUsageSource.ts`

**Interfaces:**

- Produces `parseClaudeOAuthUsage(payload)` and `makeClaudeOAuthUsageSource(input)`.
- Reads `~/.claude/.credentials.json` when present and the macOS `Claude Code-credentials` Keychain item otherwise.
- Calls `GET https://api.anthropic.com/api/oauth/usage` with the required OAuth beta header.

- [ ] Write fixture tests for Session, Weekly, Daily Routines, model-specific weekly limits, missing windows, and invalid payloads.
- [ ] Run `vp test run apps/server/src/provider/usage/claudeOAuthUsage.test.ts` and confirm the new tests fail.
- [ ] Implement credential decoding, bounded Keychain invocation, HTTP fetching, and payload normalization.
- [ ] Make `claudeUsageSource.ts` prefer OAuth and fall back to the current PTY probe only for credential/unavailable failures.
- [ ] Re-run the focused Claude usage tests and commit.

### Task 2: Codex OAuth enrichment

**Files:**

- Create: `apps/server/src/provider/usage/codexOAuthUsage.ts`
- Create: `apps/server/src/provider/usage/codexOAuthUsage.test.ts`
- Modify: `apps/server/src/provider/usage/codexUsageSource.ts`
- Modify: `apps/server/src/provider/usage/codexUsage.ts`

**Interfaces:**

- Produces `parseCodexOAuthUsage(payload)` and `makeCodexOAuthUsageSource(input)`.
- Reads the effective provider instance `CODEX_HOME/auth.json`.
- Calls `GET https://chatgpt.com/backend-api/wham/usage` and returns main, Spark, and Code review windows when reported.

- [ ] Write fixture tests for Weekly, Spark, Code review, nullable Code review, reset timestamps, and malformed payloads.
- [ ] Run `vp test run apps/server/src/provider/usage/codexOAuthUsage.test.ts` and confirm failure.
- [ ] Implement credential resolution, bounded HTTP request, parsing, and deterministic window merging.
- [ ] Preserve app-server windows when OAuth enrichment is unavailable or omits a field.
- [ ] Re-run focused Codex usage tests and commit.

### Task 3: Provider event ingestion

**Files:**

- Modify: `apps/server/src/provider/usage/ProviderUsage.ts`
- Modify: `apps/server/src/provider/usage/managedProviderUsage.ts`
- Modify: `apps/server/src/provider/Drivers/CodexDriver.ts`
- Modify: `apps/server/src/provider/Drivers/ClaudeDriver.ts`
- Test: `apps/server/src/provider/usage/managedProviderUsage.test.ts`

**Interfaces:**

- Adds `ingestRateLimitEvent(event)` to the optional usage capability.
- Merges normalized Codex `account/rateLimits/updated` and Claude `rate_limit_event` data while preserving history.

- [ ] Add failing tests proving event ingestion updates windows immediately and retains history.
- [ ] Connect the existing normalized provider runtime events to the matching instance capability.
- [ ] Verify events do not start or overlap a scheduled refresh.
- [ ] Run the focused managed-usage and driver tests and commit.

### Task 4: Verification and delivery

**Files:**

- Verify only changed server and provider-usage web files.

- [ ] Run focused server usage and web component tests.
- [ ] Run targeted server and web typechecks, formatting, lint, and `git diff --check`.
- [ ] Exercise live Claude and Codex OAuth collection without printing credentials.
- [ ] Confirm Session/Weekly Claude bars and all available Codex windows in the running isolated T3 preview.
- [ ] Commit, push `feat/provider-usage-topbar`, and leave the requested preview server running.

## Deferred Desktop Fallback

When `code_review_rate_limit` is `null`, obtaining Code review requires a separately authenticated ChatGPT dashboard session. That desktop-only fallback should reuse `BrowserSession` and `ElectronSafeStorage`, but it is deliberately separate from the native provider-source work because remote T3 servers cannot use a local Electron session.
