# External Chat Catalog Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show meaningful top-level Codex and Claude chats with provider icons in the import catalog.

**Architecture:** Tighten native discovery at the parser/catalog boundary so injected metadata never becomes user-facing copy and parented sessions never become candidates. Reuse the existing web provider-icon abstraction in candidate rows while retaining accessible provider names.

**Tech Stack:** TypeScript, Effect, React, Vite+, Vitest.

## Global Constraints

- Native Codex and Claude source files remain read-only.
- Only top-level native sessions are discoverable.
- Existing import identity and resumability behavior must remain unchanged.
- Use focused tests and affected-package checks only.

---

### Task 1: Clean native candidate discovery

**Files:**

- Modify: `apps/server/src/externalChats/ExternalChatCatalog.ts`
- Modify: `apps/server/src/externalChats/ExternalChatCatalog.test.ts`
- Modify/Create fixtures: `apps/server/src/externalChats/__fixtures__/codex/`

**Interfaces:**

- Consumes: native Codex JSONL records and normalized historical events.
- Produces: catalog candidates whose `title` and `preview` come from genuine user content; no candidate for a transcript with a native parent-thread ID.

- [ ] **Step 1: Write failing discovery tests**

Add one fixture whose first visible payload is `<recommended_plugins>...</recommended_plugins>` followed by a genuine user prompt, and one Codex fixture whose `session_meta.payload.source.subagent.thread_spawn.parent_thread_id` points to a parent. Assert the first candidate uses the genuine prompt and the parented candidate is absent.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
node_modules/.bin/vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts
```

Expected: title assertion includes `recommended_plugins`, and the parented native session remains in the candidate list.

- [ ] **Step 3: Implement minimal parser/catalog filtering**

Add a narrow predicate for injected message wrappers and capture Codex parent-thread metadata while parsing `session_meta`. Make `firstMessage` skip injected messages and make scanning skip parsed sessions with a parent thread ID.

- [ ] **Step 4: Verify discovery tests pass**

Run the Task 1 command again. Expected: all catalog tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/externalChats
git commit -m "fix: show only top-level external chats"
```

### Task 2: Render provider icons in candidate rows

**Files:**

- Modify: `apps/web/src/components/ExternalChatImportDialog.tsx`
- Modify: `apps/web/src/components/ExternalChatImportDialog.test.tsx`
- Inspect/reuse: `apps/web/src/components/chat/ModelListRow.tsx`

**Interfaces:**

- Consumes: `ExternalChatCandidate.source` and the existing shared provider-icon component/API.
- Produces: a candidate-row provider marker with the correct Codex or Claude icon and accessible provider name.

- [ ] **Step 1: Write failing component tests**

Render one Codex and one Claude candidate. Assert each row contains the existing provider icon marker and accessible name, and does not render `codex` or `claudeAgent` as the footer identifier.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
node_modules/.bin/vp test run apps/web/src/components/ExternalChatImportDialog.test.tsx
```

Expected: icon queries fail and the raw driver text is still present.

- [ ] **Step 3: Reuse the shared provider icon**

Map candidate source `codex` to the Codex driver kind and `claude` to the Claude Agent driver kind, then render the existing provider icon with an accessible provider label in the candidate header/footer.

- [ ] **Step 4: Verify component tests pass**

Run the Task 2 command again. Expected: all dialog tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ExternalChatImportDialog.tsx apps/web/src/components/ExternalChatImportDialog.test.tsx
git commit -m "fix: use provider icons in chat imports"
```

### Task 3: Focused verification and browser refresh

**Files:**

- Verify all files changed by Tasks 1 and 2.

**Interfaces:**

- Consumes: completed server discovery and web presentation changes.
- Produces: verified browser-visible behavior in the isolated demo.

- [ ] **Step 1: Run focused automated verification**

```bash
node_modules/.bin/vp test run apps/server/src/externalChats/ExternalChatCatalog.test.ts apps/server/src/externalChats/ExternalChatService.test.ts apps/web/src/components/ExternalChatImportDialog.logic.test.ts apps/web/src/components/ExternalChatImportDialog.test.tsx
pnpm --dir apps/server typecheck
pnpm --filter @t3tools/web typecheck
```

Expected: all tests and both typechecks pass.

- [ ] **Step 2: Run targeted static checks**

Run Vite+ lint and formatting checks for the changed TypeScript files, followed by `git diff --check`. Expected: no errors or warnings introduced by this change.

- [ ] **Step 3: Refresh the isolated browser demo**

Restart or refresh the existing isolated feature server, open `Import chats`, and verify genuine titles, Codex/Claude icons, and absence of parented subagent sessions.

- [ ] **Step 4: Commit and push**

Commit any final verification-driven correction and push `feat/external-chat-import` to `origin` while preserving the worktree.
