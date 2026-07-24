# Upstream Main Integration Design

## Goal

Merge `pingdotgg/t3code` `upstream/main` into the Pandoks fork without losing fork-only functionality, then verify, package, reinstall, and publish the integrated result to `origin/main`.

## Strategy

Create a merge commit from the fork's current `main`. Resolve conflicts by treating the fork's shipped features as invariants while adopting upstream architecture, fixes, and UI behavior around them. Do not replace the fork wholesale with upstream or rebase its public history.

## Fork invariants

- Native provider usage limits, keyed by `ProviderInstanceId`, including nullable Claude reset timestamps and known-null windows.
- Provider configuration management for Codex and Claude.
- Native external Codex and Claude chat import with provenance and resume guarantees.
- Integrated pull-request browser action.
- Fork-specific Ghostty terminal, Neovim, desktop installer, and update-pill behavior.
- The compact Claude usage card introduced in `addec9617`.

## Verification

Start with the tests attached to conflicted files and each invariant subsystem. Run targeted formatting, linting, and type checks for affected packages. Then perform one isolated integrated web pass, build the desktop application, install it through the repository-owned installer, launch the installed bundle, and only then push the merge to `origin/main`.
