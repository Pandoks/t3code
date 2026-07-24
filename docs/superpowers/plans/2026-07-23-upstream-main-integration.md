# Upstream Main Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge current official T3 Code upstream into the Pandoks fork while preserving fork-only behavior, then verify, reinstall, and publish.

**Architecture:** Use a merge commit so future upstream synchronization shares ancestry. Resolve conflicts subsystem-by-subsystem, adapting fork features onto upstream APIs and UI rather than selecting one complete side.

**Tech Stack:** Git, TypeScript, Effect, React, Vite+, Electron.

## Global Constraints

- Preserve all fork invariants listed in the companion design.
- Do not edit or stage the unrelated terminal work in the original checkout.
- Do not run the full workspace test suite locally.
- Run focused tests for every conflicted subsystem plus affected package checks.
- Push only after the packaged desktop app installs and launches.

---

### Task 1: Merge and inventory

**Files:** Conflict-dependent.

- [ ] Fetch both remotes and merge `upstream/main` with `--no-ff --no-commit`.
- [ ] Record every conflicted path and map it to its owning subsystem.
- [ ] Resolve structural conflicts first: package manifests, contracts, RPC, migrations, and shared runtime.

### Task 2: Preserve fork backend features

**Files:** Conflict-dependent under `apps/server`, `packages/contracts`, and `packages/client-runtime`.

- [ ] Preserve provider usage and configuration contracts, services, RPCs, adapters, and tests while incorporating upstream provider/session changes.
- [ ] Preserve external chat import storage, migration, orchestration, catalog, RPC, and tests while incorporating upstream orchestration changes.
- [ ] Preserve terminal and desktop-specific behavior while incorporating upstream server updates, project configuration, and preview automation.

### Task 3: Preserve fork client features

**Files:** Conflict-dependent under `apps/web`, `apps/mobile`, and `apps/desktop`.

- [ ] Preserve provider usage/configuration UI and compact Claude card.
- [ ] Preserve external chat import and integrated pull-request browser UI.
- [ ] Integrate upstream sidebar, composer, glass, project grouping, thread-state, preview, desktop-update, and mobile changes.

### Task 4: Verify the merge

**Files:** Tests adjacent to resolved conflicts.

- [ ] Run focused tests for all conflicted and fork-invariant subsystems.
- [ ] Run formatting, targeted lint, and package type checks for affected packages.
- [ ] Run one isolated integrated web verification pass with `test-t3-app`.
- [ ] Inspect the merge diff and confirm every fork invariant still has source and test coverage.

### Task 5: Package and publish

**Files:** None.

- [ ] Commit the merge.
- [ ] Run `vp run dist:desktop:install`.
- [ ] Confirm installed version, modification time, and a running app process.
- [ ] Push the merge commit directly to `origin/main`.
