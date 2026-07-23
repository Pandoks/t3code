# View PR in Integrated Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the Git actions control's **View PR** target in the active thread's integrated browser panel.

**Architecture:** Extend the focused pull-request link helper with preview-first orchestration built from the existing `openUrlInPreview` and runtime capability APIs. Wire `GitActionsControl` to supply its active thread and preview mutation, while retaining the existing external shell path as a fallback.

**Tech Stack:** TypeScript, React, Effect Atom, Vite+ Test, Zustand right-panel state.

## Global Constraints

- Only the quick **View PR** button and matching dropdown action change.
- Other pull-request links remain unchanged.
- No setting or protocol change is added.
- Preview failures fall back to the external system browser.
- Error diagnostics must not expose URL query parameters.

---

### Task 1: Preview-first pull-request link helper

**Files:**
- Modify: `apps/web/src/lib/openPullRequestLink.ts`
- Modify: `apps/web/src/lib/openPullRequestLink.test.ts`

**Interfaces:**
- Consumes: `ScopedThreadRef`, `OpenPreviewMutation`, `isPreviewSupportedInRuntime`, `openUrlInPreview`, and `LocalApi.shell.openExternal`.
- Produces: `openPullRequestInPreview({ threadRef, targetUrl, openPreview, shell }): Promise<void>`.

- [ ] **Step 1: Write failing tests**

Add tests proving that the helper opens a preview successfully, falls back externally when preview is unsupported, and falls back externally when the preview mutation fails.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `vp test run apps/web/src/lib/openPullRequestLink.test.ts`

Expected: FAIL because `openPullRequestInPreview` is not exported.

- [ ] **Step 3: Implement the preview-first helper**

Implement `openPullRequestInPreview` so it calls `openUrlInPreview` only for a non-empty active thread in a supported runtime. Return on preview success; otherwise call the existing `openPullRequestLink` external path.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `vp test run apps/web/src/lib/openPullRequestLink.test.ts`

Expected: all tests PASS.

### Task 2: Wire Git actions to the integrated browser

**Files:**
- Modify: `apps/web/src/components/GitActionsControl.tsx`
- Modify: `apps/web/src/components/GitActionsControl.logic.test.ts`

**Interfaces:**
- Consumes: `openPullRequestInPreview` and `previewEnvironment.open`.
- Produces: quick-button and dropdown **View PR** behavior using the integrated browser.

- [ ] **Step 1: Add a focused control-level assertion**

Add or update the focused Git actions test to assert that the `open_pr` action remains available for an open pull request while the helper tests own navigation behavior.

- [ ] **Step 2: Create the preview mutation and update `openExistingPr`**

Instantiate `useAtomCommand(previewEnvironment.open, { reportFailure: false })`, require the active thread for preview, and call `openPullRequestInPreview` with the existing safe toast handling.

- [ ] **Step 3: Run focused tests**

Run: `vp test run apps/web/src/lib/openPullRequestLink.test.ts apps/web/src/components/GitActionsControl.logic.test.ts`

Expected: all tests PASS.

- [ ] **Step 4: Run targeted static checks**

Run formatting, lint, and TypeScript checks scoped to the touched web files using the repository's Vite+ commands.

Expected: commands exit successfully.

- [ ] **Step 5: Commit implementation**

Commit the helper, control wiring, and tests with `feat(web): open pull requests in integrated browser`.

### Task 3: Integrated UI verification

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: the completed web implementation.
- Produces: empirical evidence that **View PR** reveals the integrated browser with the PR URL.

- [ ] **Step 1: Launch isolated T3 web environment**

Run `vp run dev --home-dir <new-worktree-local-or-temporary-directory>` and use the printed one-time pairing URL once in the controlled browser.

- [ ] **Step 2: Exercise View PR**

Open a thread whose branch has an open PR, activate **View PR**, and verify that the right panel shows a browser surface navigating to that PR without launching a system browser.

- [ ] **Step 3: Inspect errors and stop the environment**

Confirm there are no related browser-console or server errors, then interrupt the dev process and remove only disposable state created for this test.

- [ ] **Step 4: Push the completed branch**

Push `t3code/view-pull-requests-in-browser` to `origin`.
