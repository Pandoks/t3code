import type { ExternalChatCandidate } from "@t3tools/contracts";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { ExternalChatCandidateRow, ExternalChatImportTrigger } from "./ExternalChatImportDialog";

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
});

describe("ExternalChatCandidateRow", () => {
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
