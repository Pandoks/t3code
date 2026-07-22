import type { ExternalChatCandidate } from "@t3tools/contracts";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ExternalChatCandidateRow,
  ExternalChatEnvironmentSelector,
  ExternalChatErrorAlert,
  ExternalChatImportActionButton,
  ExternalChatImportDialogFrame,
  ExternalChatImportSearchInput,
  ExternalChatImportTrigger,
  ExternalChatRefreshButton,
} from "./ExternalChatImportDialog";

const candidate = (overrides: Record<string, unknown> = {}): ExternalChatCandidate =>
  ({
    source: "claude",
    candidateId: "candidate-1",
    providerInstanceId: "claudeAgent",
    nativeSessionId: "native-1",
    cwd: "/work/unknown",
    title: "Investigate reconnect",
    preview: "Follow websocket events across reconnects",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T11:00:00.000Z",
    messageCount: 12,
    resumability: { status: "not_resumable", reason: "Native source is unavailable." },
    ...overrides,
  }) as ExternalChatCandidate;

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement<{ readonly children?: ReactNode }>(node)) return "";
  return Children.toArray(node.props.children).map(textContent).join(" ");
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (predicate(node)) return node;
  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

describe("ExternalChatImportTrigger", () => {
  it("uses the sidebar action label and opens the import flow", () => {
    const onOpen = vi.fn();
    const trigger = ExternalChatImportTrigger({ onOpen, tooltipSide: "right" });
    const tooltipTrigger = Children.toArray(trigger.props.children)[0] as ReactElement<{
      readonly render: ReactElement<{ readonly onClick: () => void }>;
    }>;

    expect(textContent(trigger)).toContain("Import chats…");
    tooltipTrigger.props.render.props.onClick();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("uses the adjacent 28px bordered control pattern in SidebarV2", () => {
    const trigger = ExternalChatImportTrigger({
      onOpen: vi.fn(),
      tooltipSide: "right",
      variant: "sidebar-v2",
    });

    expect(trigger.props.className).toContain("size-7");
    expect(trigger.props.className).toContain("border");
    expect(trigger.props["aria-label"]).toBe("Import chats");
  });
});

describe("ExternalChatImportDialog controls", () => {
  it("makes refresh and import mutually exclusive", () => {
    const onRefresh = vi.fn();
    const refresh = ExternalChatRefreshButton({
      isRefreshing: false,
      isImporting: true,
      onRefresh,
    });
    expect(refresh.props.disabled).toBe(true);
    refresh.props.onClick();
    expect(onRefresh).not.toHaveBeenCalled();

    const onImport = vi.fn();
    const importAction = ExternalChatImportActionButton({
      selectedCount: 1,
      hasUnresolvedCandidates: false,
      hasEnvironment: true,
      isRefreshing: true,
      isImporting: false,
      onImport,
    });
    expect(importAction.props.disabled).toBe(true);
    importAction.props.onClick();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("ignores every root close request while import is active", () => {
    const onOpenChange = vi.fn();
    const importingFrame = ExternalChatImportDialogFrame({
      open: true,
      isImporting: true,
      onOpenChange,
      children: null,
    });

    importingFrame.props.onOpenChange(false);
    expect(onOpenChange).not.toHaveBeenCalled();
    importingFrame.props.onOpenChange(true);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    const idleFrame = ExternalChatImportDialogFrame({
      open: true,
      isImporting: false,
      onOpenChange,
      children: null,
    });
    idleFrame.props.onOpenChange(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("gives chat search a programmatic accessible name", () => {
    const search = ExternalChatImportSearchInput({ value: "", onChange: vi.fn() });
    const input = Children.toArray(search.props.children)[1] as ReactElement<{
      readonly "aria-label"?: string;
    }>;

    expect(input.props["aria-label"]).toBe("Search external chats");
  });

  it("offers every connected environment when more than one is available", () => {
    const onEnvironmentChange = vi.fn();
    const selector = ExternalChatEnvironmentSelector({
      environments: [
        { environmentId: "primary", label: "This Mac" },
        { environmentId: "remote", label: "Remote Mac" },
      ],
      environmentId: "remote",
      onEnvironmentChange,
    });

    expect(selector).not.toBeNull();
    expect(textContent(selector)).toContain("This Mac");
    expect(textContent(selector)).toContain("Remote Mac");
    expect(selector!.props.value).toBe("remote");
  });

  it("uses action-specific mutation wording instead of list-unavailable wording", () => {
    expect(
      textContent(ExternalChatErrorAlert({ kind: "list", message: "No connection." })),
    ).toContain("External chats unavailable");
    expect(
      textContent(ExternalChatErrorAlert({ kind: "refresh", message: "Refresh timed out." })),
    ).toContain("Refresh failed");
    expect(
      textContent(ExternalChatErrorAlert({ kind: "import", message: "Import timed out." })),
    ).toContain("Import failed");
  });
});

describe("ExternalChatCandidateRow", () => {
  it("prevents selection mutation while another lifecycle request is active", () => {
    const onSelect = vi.fn();
    const row = ExternalChatCandidateRow({
      candidate: candidate(),
      selected: false,
      disabled: true,
      destinationProjectId: null,
      projects: [],
      error: null,
      onSelect,
      onProjectChange: vi.fn(),
      onOpenImported: vi.fn(),
    });
    const checkbox = findElement(
      row,
      (element) => element.props["aria-label"] === "Select Investigate reconnect",
    );

    expect(checkbox?.props.disabled).toBe(true);
    (checkbox?.props.onCheckedChange as (() => void) | undefined)?.();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("links an imported unavailable chat and presents it as read-only", () => {
    const row = ExternalChatCandidateRow({
      candidate: candidate({ alreadyImportedThreadId: "thread-existing" }),
      selected: false,
      destinationProjectId: null,
      projects: [],
      error: null,
      onSelect: vi.fn(),
      onProjectChange: vi.fn(),
      onOpenImported: vi.fn(),
    });

    expect(textContent(row)).toContain("Read-only");
    expect(textContent(row)).toContain("Open imported chat");
    expect(textContent(row)).toContain("Native source is unavailable.");
  });

  it("asks for a project when a selected candidate cannot be resolved", () => {
    const row = ExternalChatCandidateRow({
      candidate: candidate(),
      selected: true,
      destinationProjectId: null,
      projects: [{ id: "project-a", title: "Alpha", workspaceRoot: "/work/alpha" }],
      error: "Choose a project before importing.",
      onSelect: vi.fn(),
      onProjectChange: vi.fn(),
      onOpenImported: vi.fn(),
    });

    expect(textContent(row)).toContain("Choose a project");
    expect(textContent(row)).toContain("Choose a project before importing.");
  });
});
