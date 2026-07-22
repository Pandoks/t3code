import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ExternalChatCandidate,
  ExternalChatImportRequest,
  ExternalChatImportResult,
  ExternalChatListResult,
  ExternalChatRefreshRequest,
  ExternalChatRefreshResult,
  NormalizedHistoricalEvent,
} from "./externalChats.ts";
import { WS_METHODS } from "./rpc.ts";

describe("external chat contracts", () => {
  it("declares the typed external chat RPC method names", () => {
    expect(WS_METHODS.externalChatsList).toBe("externalChats.list");
    expect(WS_METHODS.externalChatsRefresh).toBe("externalChats.refresh");
    expect(WS_METHODS.externalChatsImport).toBe("externalChats.import");
  });

  it("decodes complete discovery metadata", () => {
    const decoded = Schema.decodeUnknownSync(ExternalChatCandidate)({
      source: "codex",
      candidateId: "extchat_v1_0123456789abcdef",
      providerInstanceId: "codex_work",
      nativeSessionId: "019f-session",
      cwd: "/workspace/t3code",
      projectPath: "/workspace/t3code",
      title: "Import external chats",
      preview: "Build the read-only session catalog.",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:04:00.000Z",
      messageCount: 2,
      resumability: {
        status: "resumable",
      },
      alreadyImportedThreadId: "thread-existing",
    });

    expect(decoded).toMatchObject({
      source: "codex",
      providerInstanceId: "codex_work",
      messageCount: 2,
      resumability: { status: "resumable" },
      alreadyImportedThreadId: "thread-existing",
    });
  });

  it("keeps bulk import inputs candidate-based and strips arbitrary filesystem paths", () => {
    const decoded = Schema.decodeUnknownSync(ExternalChatImportRequest)({
      candidateIds: ["extchat_v1_0123456789abcdef"],
      projectId: "project-override",
      sourcePath: "/tmp/untrusted.jsonl",
    });

    expect(decoded).toEqual({
      candidateIds: ["extchat_v1_0123456789abcdef"],
      projectId: "project-override",
    });
    expect(decoded).not.toHaveProperty("sourcePath");
  });

  it("defines list, import, and refresh result envelopes", () => {
    const candidate = {
      source: "claude",
      candidateId: "extchat_v1_fedcba9876543210",
      providerInstanceId: "claude_work",
      nativeSessionId: "claude-session",
      projectPath: "/workspace/claude",
      title: "Claude session",
      preview: "Inspect the project.",
      createdAt: "2026-07-20T11:00:00.000Z",
      updatedAt: "2026-07-20T11:02:00.000Z",
      messageCount: 1,
      resumability: { status: "unknown", reason: "Working directory unavailable." },
    } as const;

    expect(
      Schema.decodeUnknownSync(ExternalChatListResult)({ candidates: [candidate] }).candidates,
    ).toHaveLength(1);
    expect(
      Schema.decodeUnknownSync(ExternalChatImportResult)({
        results: [
          {
            candidateId: candidate.candidateId,
            threadId: "thread-new",
            status: "imported",
            resumability: candidate.resumability,
          },
        ],
      }).results[0]?.status,
    ).toBe("imported");
    expect(
      Schema.decodeUnknownSync(ExternalChatRefreshRequest)({
        sources: ["claude"],
        providerInstanceIds: ["claude_work"],
      }).sources,
    ).toEqual(["claude"]);
    expect(
      Schema.decodeUnknownSync(ExternalChatRefreshResult)({
        candidates: [candidate],
        refreshedAt: "2026-07-20T12:00:00.000Z",
      }).refreshedAt,
    ).toBe("2026-07-20T12:00:00.000Z");
  });

  it("decodes the normalized visible historical-event variants", () => {
    const decode = Schema.decodeUnknownSync(NormalizedHistoricalEvent);
    const events = [
      { type: "message", role: "user", text: "Fix it", timestamp: "2026-07-20T10:00:00Z" },
      { type: "tool", name: "Read", status: "completed", summary: "src/main.ts" },
      { type: "command", command: "pnpm test", status: "failed", exitCode: 1 },
      { type: "fileChange", path: "src/main.ts", patch: "@@ -1 +1 @@" },
      { type: "plan", text: "1. Reproduce\n2. Fix" },
      { type: "error", message: "Test failed" },
      { type: "turn", status: "interrupted", reason: "user interrupt" },
    ];

    expect(events.map((event) => decode(event)).map((event) => event.type)).toEqual([
      "message",
      "tool",
      "command",
      "fileChange",
      "plan",
      "error",
      "turn",
    ]);
  });

  it("preserves native tool correlation on tool, command, and file-change events", () => {
    const decode = Schema.decodeUnknownSync(NormalizedHistoricalEvent);

    expect(
      decode({
        type: "tool",
        name: "render_diagram",
        status: "completed",
        toolUseId: "call-1",
      }),
    ).toMatchObject({ toolUseId: "call-1" });
    expect(
      decode({
        type: "command",
        command: "pnpm test",
        status: "failed",
        output: "failed",
        toolUseId: "tool-2",
      }),
    ).toMatchObject({ toolUseId: "tool-2" });
    expect(
      decode({
        type: "fileChange",
        path: "src/server.ts",
        status: "completed",
        output: "File updated",
        toolUseId: "tool-3",
      }),
    ).toMatchObject({ output: "File updated", toolUseId: "tool-3" });
  });
});
