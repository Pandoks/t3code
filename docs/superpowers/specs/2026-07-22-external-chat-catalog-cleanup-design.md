# External Chat Catalog Cleanup

## Goal

Make the external-chat import catalog show meaningful top-level Codex and Claude conversations with recognizable provider icons.

## Discovery behavior

- Title and preview selection must ignore injected metadata messages, including `<recommended_plugins>` blocks and system, developer, command, or environment wrappers.
- The first genuine user-authored message becomes the title and preview fallback. A native title still takes precedence when available.
- Codex transcripts with a native parent-thread identifier are subagent sessions and must not appear as import candidates.
- Claude sidechain and nested-agent transcripts remain excluded by the existing native sidechain detection.
- Filtering affects discovery only. Native source files remain read-only.

## Presentation

- Candidate rows use the existing shared provider-icon component for Codex and Claude.
- Text such as `codex` and `claudeAgent` must not be used as the visual provider identifier.
- Accessible provider names remain available through labels or visually hidden text.

## Verification

- Parser fixtures prove injected plugin metadata is skipped when deriving titles and previews.
- Codex fixtures prove parented sessions are excluded while top-level sessions remain.
- Existing Claude sidechain tests continue to pass.
- Component tests prove candidate rows render the appropriate provider icon and accessible provider name.
- The focused server and web tests, targeted typechecks, lint, and formatting must pass.
- Refresh the isolated browser demo and confirm the catalog shows meaningful titles, provider icons, and no subagent candidates.
