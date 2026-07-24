# Claude Usage Card Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the oversized Claude percentage headline, verify the real web UI, rebuild and reinstall the macOS desktop app, and audit the fork against official upstream.

**Architecture:** Keep provider usage data and quota rows unchanged. Remove only the redundant Claude-only headline block from `ProviderUsageDashboard`, cover the rendering contract with its existing focused test file, and use the repository-owned desktop installer for packaging and replacement.

**Tech Stack:** React, TypeScript, Vite+, Electron, git.

## Global Constraints

- Preserve unrelated terminal edits already present in the worktree.
- Do not alter Codex usage-card behavior.
- Keep Claude quota rows, percentages, progress bars, and reset labels.
- Use focused tests and checks; do not run the full workspace suite.

---

### Task 1: Remove the Claude headline

**Files:**

- Modify: `apps/web/src/components/chat/providerUsage/ProviderUsageDashboard.tsx`
- Test: `apps/web/src/components/chat/providerUsage/ProviderUsageDashboard.test.tsx`

**Interfaces:**

- Consumes: `ProviderUsageDashboardSnapshot`
- Produces: Claude cards whose quota details render only in the existing `aria-label="Quota windows"` section

- [ ] **Step 1: Write the failing rendering test**

Add a Claude snapshot assertion that the markup contains the Session quota row but does not contain the headline class `text-2xl`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `vp test run apps/web/src/components/chat/providerUsage/ProviderUsageDashboard.test.tsx`

Expected: FAIL because the Claude headline currently contains `text-2xl`.

- [ ] **Step 3: Remove the redundant block**

Delete the Claude-only headline section and now-unused `headline` local while leaving the quota-window section untouched.

- [ ] **Step 4: Run focused verification**

Run:

```bash
vp test run apps/web/src/components/chat/providerUsage/ProviderUsageDashboard.test.tsx
vp fmt --check apps/web/src/components/chat/providerUsage/ProviderUsageDashboard.tsx apps/web/src/components/chat/providerUsage/ProviderUsageDashboard.test.tsx
vp run --filter @t3tools/web typecheck
```

Expected: all commands pass.

### Task 2: Verify the integrated web UI

**Files:** None.

**Interfaces:**

- Consumes: the updated web app
- Produces: browser evidence that the Claude card has no oversized headline and retains quota rows

- [ ] **Step 1: Launch an isolated environment**

Run `vp run dev --home-dir <fresh-temp-directory>` and authenticate the controlled in-app browser using the one-time pairing URL.

- [ ] **Step 2: Exercise the provider usage popover**

Open a Claude usage card and confirm the Session row, percentage, progress bar, and reset label remain while the oversized percentage headline is absent.

- [ ] **Step 3: Stop the isolated environment**

Interrupt the dev process after verification.

### Task 3: Build and reinstall T3 Code

**Files:** None.

**Interfaces:**

- Consumes: the verified repository state
- Produces: a newly built `/Applications/T3 Code.app`

- [ ] **Step 1: Run the repository-owned installer**

Run: `vp run dist:desktop:install`

Expected: the script builds a macOS DMG, quits the installed app, replaces the application bundle, and reports successful installation.

- [ ] **Step 2: Confirm the installed bundle**

Inspect `/Applications/T3 Code.app` metadata and launch the installed application.

### Task 4: Audit upstream drift

**Files:** None.

**Interfaces:**

- Consumes: `upstream/main`, the current local `main`, and `origin/main`
- Produces: exact ahead/behind counts plus a concise classification of upstream-only commits

- [ ] **Step 1: Refresh remote refs**

Run: `git fetch --prune upstream origin`

- [ ] **Step 2: Compare histories**

Run:

```bash
git rev-list --left-right --count HEAD...upstream/main
git log --oneline --no-merges HEAD..upstream/main
git log --oneline --no-merges upstream/main..HEAD
```

- [ ] **Step 3: Inspect upstream-only changes**

Group upstream-only commits by user-visible features, fixes, maintenance, and conflicts with fork-specific changes; report commit hashes and verification date.
