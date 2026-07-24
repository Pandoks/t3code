# Claude Usage Card Density Design

## Goal

Remove the oversized percentage headline from Claude provider usage cards while preserving the detailed quota rows, progress bars, reset times, provider status, and history.

## Design

`ProviderUsageDashboard` will stop rendering its Claude-only headline section. The quota-window list already repeats the same percentage, label, reset time, and progress state in a denser form, so it remains the sole presentation of Claude limits. Codex rendering is unchanged.

## Verification

Add a focused rendering assertion that Claude cards do not contain the headline treatment while still rendering the Session quota row. Run the component test and affected web type/format checks, then verify the popover in an isolated T3 web environment.
