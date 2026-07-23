# View Pull Requests in the Integrated Browser

## Goal

When a user activates **View PR** from the web client's Git actions control, open the pull request URL in the integrated browser panel for the active thread.

## Scope

- Change the quick **View PR** button and its matching dropdown item.
- Reuse the existing preview session and right-panel browser infrastructure.
- Keep other pull-request links, such as links rendered in chat, unchanged.
- Do not add a setting: the integrated browser becomes the default for this action.

## Behavior

1. Resolve the open pull request URL from the current Git status.
2. If the active thread supports integrated preview, open the URL in a preview tab and reveal that browser surface in the right panel.
3. If preview is unavailable or opening it fails, open the same URL in the system browser through the existing shell API.
4. If neither path succeeds, show the existing safe error toast without exposing URL query parameters.

## Implementation

Extract a small pull-request-opening function that accepts the thread reference, preview mutation, shell API, and target URL. It will use the existing `openUrlInPreview` helper and runtime capability check, then fall back to `openPullRequestLink`.

`GitActionsControl` will create the preview mutation and call the new function from its existing `openExistingPr` callback. No protocol, server, desktop IPC, or settings-schema changes are needed.

## Testing

- Unit test successful integrated-preview opening.
- Unit test external fallback when preview is unavailable.
- Unit test external fallback when preview opening fails.
- Run the focused web tests, formatting/lint/type checks for touched files, and one isolated integrated web verification using the `test-t3-app` workflow.
