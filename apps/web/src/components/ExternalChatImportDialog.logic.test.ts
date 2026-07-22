import type {
  ExternalChatCandidate,
  ExternalChatImportItemResult,
  ExternalChatSource,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyExternalChatImportResults,
  buildExternalChatImportBatches,
  filterAndGroupExternalChats,
  getExternalChatCandidateState,
  resolveExternalChatImportNavigationTarget,
  summarizeExternalChatImport,
  toggleExternalChatSelection,
} from "./ExternalChatImportDialog.logic";

const candidate = (
  candidateId: string,
  overrides: Record<string, unknown> = {},
): ExternalChatCandidate =>
  ({
    source: "codex",
    candidateId,
    providerInstanceId: "codex",
    nativeSessionId: `native-${candidateId}`,
    cwd: `/work/${candidateId}`,
    projectPath: `/work/${candidateId}`,
    title: `Chat ${candidateId}`,
    preview: `Preview ${candidateId}`,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T11:00:00.000Z",
    messageCount: 4,
    resumability: { status: "resumable" },
    ...overrides,
  }) as ExternalChatCandidate;

const project = (id: string, workspaceRoot: string) => ({ id, title: id, workspaceRoot });

describe("external chat import presentation", () => {
  it("filters title, preview, and paths before grouping candidates by project path", () => {
    const candidates = [
      candidate("alpha", { source: "codex", title: "Fix parser", cwd: "/work/alpha/api" }),
      candidate("beta", {
        source: "claude",
        preview: "Investigate websocket reconnect",
        cwd: "/work/beta",
        projectPath: undefined,
      }),
      candidate("gamma", { source: "claude", cwd: "/work/gamma/mobile" }),
    ];

    expect(
      filterAndGroupExternalChats({
        candidates,
        sources: new Set<ExternalChatSource>(["claude"]),
        query: "websocket",
      }),
    ).toEqual([
      {
        key: "/work/beta",
        label: "beta",
        path: "/work/beta",
        candidates: [candidates[1]],
      },
    ]);

    expect(
      filterAndGroupExternalChats({
        candidates,
        sources: new Set<ExternalChatSource>(["codex", "claude"]),
        query: "/gamma/mobile",
      })[0]?.candidates,
    ).toEqual([candidates[2]]);
  });

  it("keeps already imported chats unselectable and labels non-resumable imports read-only", () => {
    const imported = candidate("imported", {
      alreadyImportedThreadId: "thread-existing",
      resumability: { status: "not_resumable", reason: "Native source is unavailable." },
    });

    expect(getExternalChatCandidateState(imported)).toEqual({
      canSelect: false,
      isImported: true,
      resumabilityLabel: "Read-only",
      resumabilityReason: "Native source is unavailable.",
    });
    expect(toggleExternalChatSelection(new Set(["other"]), imported)).toEqual(new Set(["other"]));
  });
});

describe("external chat import selection and mapping", () => {
  it("maps unresolved selections explicitly and batches candidates by destination project", () => {
    const nested = candidate("nested", { cwd: "/work/alpha/packages/web" });
    const unresolved = candidate("unresolved", { cwd: undefined, projectPath: undefined });

    expect(
      buildExternalChatImportBatches({
        candidates: [nested, unresolved],
        selectedIds: new Set([nested.candidateId, unresolved.candidateId]),
        projects: [project("alpha", "/work/alpha"), project("beta", "/work/beta")],
        projectMapping: { [unresolved.candidateId]: "beta" },
      }),
    ).toEqual({
      batches: [
        { projectId: "alpha", candidateIds: [nested.candidateId] },
        { projectId: "beta", candidateIds: [unresolved.candidateId] },
      ],
      unresolvedCandidateIds: [],
    });
  });

  it("reports selected candidates that still need a project", () => {
    const unresolved = candidate("unresolved", { cwd: "/outside/projects" });

    expect(
      buildExternalChatImportBatches({
        candidates: [unresolved],
        selectedIds: new Set([unresolved.candidateId]),
        projects: [project("alpha", "/work/alpha")],
        projectMapping: {},
      }),
    ).toEqual({ batches: [], unresolvedCandidateIds: [unresolved.candidateId] });
  });
});

describe("external chat import results", () => {
  const result = (
    candidateId: string,
    status: ExternalChatImportItemResult["status"],
    overrides: Record<string, unknown> = {},
  ): ExternalChatImportItemResult =>
    ({
      candidateId,
      status,
      resumability: { status: "resumable" },
      ...overrides,
    }) as ExternalChatImportItemResult;

  it("preserves per-session failures while summarizing a partial success", () => {
    expect(
      summarizeExternalChatImport([
        result("alpha", "imported", { threadId: "thread-alpha" }),
        result("beta", "failed", { error: "Native source moved." }),
        result("gamma", "skipped", { threadId: "thread-gamma" }),
      ]),
    ).toEqual({
      importedCount: 1,
      skippedCount: 1,
      failedCount: 1,
      errorsByCandidateId: new Map([["beta", "Native source moved."]]),
    });
  });

  it("navigates to the newest newly imported thread", () => {
    const candidates = [
      candidate("older", { updatedAt: "2026-07-20T10:00:00.000Z" }),
      candidate("newer", { updatedAt: "2026-07-21T10:00:00.000Z" }),
      candidate("skipped", { updatedAt: "2026-07-22T10:00:00.000Z" }),
    ];

    expect(
      resolveExternalChatImportNavigationTarget({
        candidates,
        results: [
          result("older", "imported", { threadId: "thread-older" }),
          result("newer", "imported", { threadId: "thread-newer" }),
          result("skipped", "skipped", { threadId: "thread-skipped" }),
        ],
      }),
    ).toBe("thread-newer");
  });

  it("updates successful candidates locally while preserving failed candidates", () => {
    const candidates = [candidate("alpha"), candidate("beta")];

    expect(
      applyExternalChatImportResults(candidates, [
        result("alpha", "imported", { threadId: "thread-alpha" }),
        result("beta", "failed", { error: "Native source moved." }),
      ]),
    ).toEqual([{ ...candidates[0], alreadyImportedThreadId: "thread-alpha" }, candidates[1]]);
  });
});
