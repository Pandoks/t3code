// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  scanClaudeExternalChats,
  scanCodexExternalChats,
  scanExternalChats,
} from "./ExternalChatCatalog.ts";

const fixturesRoot = NodeURL.fileURLToPath(new URL("./__fixtures__", import.meta.url));
const codexHomeRoot = NodeURL.fileURLToPath(new URL("./__fixtures__/codex", import.meta.url));
const claudeHomeRoot = NodeURL.fileURLToPath(new URL("./__fixtures__/claude", import.meta.url));

describe("external native chat catalog", () => {
  it.effect("discovers Codex metadata and normalized events in chronological order", () =>
    Effect.gen(function* () {
      const [session] = yield* scanCodexExternalChats({
        homeRoot: codexHomeRoot,
        providerInstanceId: ProviderInstanceId.make("codex_work"),
      });

      expect(session).toBeDefined();
      expect(session?.candidate).toMatchObject({
        source: "codex",
        providerInstanceId: "codex_work",
        nativeSessionId: "codex-session-alpha",
        cwd: "/workspace/alpha",
        projectPath: "/workspace/alpha",
        title: "Fix the parser",
        preview: "Fix the parser",
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:09.000Z",
        messageCount: 3,
        resumability: { status: "resumable" },
      });
      expect(session?.sourceFile).toMatch(/rollout-alpha\.jsonl$/);
      expect(session?.events.map((event) => event.type)).toEqual([
        "message",
        "command",
        "fileChange",
        "plan",
        "tool",
        "tool",
        "command",
        "command",
        "fileChange",
        "fileChange",
        "error",
        "message",
        "message",
        "turn",
        "turn",
      ]);
      expect(session?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool",
            name: "render_diagram",
            status: "started",
            toolUseId: "custom-1",
            summary: '{"topic":"catalog"}',
          }),
          expect.objectContaining({
            type: "tool",
            name: "render_diagram",
            status: "completed",
            toolUseId: "custom-1",
            summary: "rendered diagram",
          }),
          expect.objectContaining({
            type: "command",
            command: "pnpm test --filter catalog",
            status: "started",
            toolUseId: "custom-shell",
          }),
          expect.objectContaining({
            type: "command",
            command: "pnpm test --filter catalog",
            status: "completed",
            toolUseId: "custom-shell",
            output: "tests passed",
          }),
          expect.objectContaining({
            type: "fileChange",
            path: "src/catalog.ts",
            patch: "@@ -1 +1 @@",
            status: "started",
            toolUseId: "custom-patch",
          }),
          expect.objectContaining({
            type: "fileChange",
            path: "src/catalog.ts",
            patch: "@@ -1 +1 @@",
            status: "completed",
            toolUseId: "custom-patch",
            output: "Done!",
          }),
        ]),
      );
      expect(
        session?.events
          .filter((event) => event.type === "message")
          .map((event) => ({ role: event.role, text: event.text })),
      ).toEqual([
        { role: "user", text: "Fix the parser" },
        { role: "assistant", text: "Implemented the parser." },
        { role: "user", text: "Fix the parser" },
      ]);
      expect(session?.events.map((event) => event.timestamp)).toEqual(
        [...(session?.events ?? [])]
          .map((event) => event.timestamp)
          .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
      );
      expect(session?.diagnostics).toEqual([
        expect.objectContaining({ kind: "malformed", line: 23 }),
        expect.objectContaining({ kind: "unknown", line: 24, recordType: "future_native_record" }),
      ]);

      const visible = NodeUtil.inspect({ candidate: session?.candidate, events: session?.events });
      expect(visible).not.toContain("HIDDEN_SYSTEM_PROMPT");
      expect(visible).not.toContain("HIDDEN_DEVELOPER_PROMPT");
      expect(visible).not.toContain("SUPER_SECRET_TOKEN");
      expect(visible).not.toContain("UNKNOWN_SECRET_PAYLOAD");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("uses genuine prompts and excludes parented Codex subagent transcripts", () =>
    Effect.gen(function* () {
      const sessions = yield* scanCodexExternalChats({
        homeRoot: codexHomeRoot,
        providerInstanceId: ProviderInstanceId.make("codex_work"),
      });

      const injected = sessions.find(
        (session) => session.candidate.nativeSessionId === "codex-session-injected",
      );
      expect(injected?.candidate).toMatchObject({
        title: "Draft an importing plan",
        preview: "Draft an importing plan",
      });
      expect(sessions.map((session) => session.candidate.nativeSessionId)).not.toContain(
        "codex-session-parented",
      );
      expect(sessions.map((session) => session.candidate.nativeSessionId)).not.toContain(
        "codex-session-top-level-parent",
      );
      expect(sessions.map((session) => session.candidate.nativeSessionId)).not.toContain(
        "codex-session-subagent-source",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps ordinary user-authored markup eligible for title and preview", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-codex-markup-"))),
      (homeRoot) =>
        Effect.gen(function* () {
          const sessionsRoot = NodePath.join(homeRoot, "sessions", "2026", "07", "20");
          yield* Effect.promise(() => NodeFSP.mkdir(sessionsRoot, { recursive: true }));
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(sessionsRoot, "rollout-markup.jsonl"),
              [
                '{"timestamp":"2026-07-20T10:00:00.000Z","type":"session_meta","payload":{"id":"codex-session-markup","cwd":"/workspace/markup","source":"vscode"}}',
                '{"timestamp":"2026-07-20T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<request>Keep this markup</request>"}]}}',
              ].join("\n"),
            ),
          );

          const [session] = yield* scanCodexExternalChats({
            homeRoot,
            providerInstanceId: ProviderInstanceId.make("codex_work"),
          });

          expect(session?.candidate).toMatchObject({
            title: "<request>Keep this markup</request>",
            preview: "<request>Keep this markup</request>",
          });
        }),
      (homeRoot) => Effect.promise(() => NodeFSP.rm(homeRoot, { recursive: true, force: true })),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("discovers Claude messages, tools, commands, file changes, plans, and errors", () =>
    Effect.gen(function* () {
      const [session] = yield* scanClaudeExternalChats({
        homeRoot: claudeHomeRoot,
        providerInstanceId: ProviderInstanceId.make("claude_work"),
      });

      expect(session?.candidate).toMatchObject({
        source: "claude",
        providerInstanceId: "claude_work",
        nativeSessionId: "8dcd1b39-8e74-41f0-a07c-b876917a46c4",
        cwd: "/workspace/beta",
        projectPath: "/workspace/beta",
        title: "Add import support",
        preview: "Add import support",
        createdAt: "2026-07-20T11:00:00.000Z",
        updatedAt: "2026-07-20T11:00:09.000Z",
        messageCount: 7,
        resumability: { status: "resumable" },
      });
      expect(session).toMatchObject({ lastAssistantUuid: "assistant-3" });
      expect(session?.events.map((event) => event.type)).toEqual([
        "message",
        "message",
        "message",
        "message",
        "tool",
        "command",
        "fileChange",
        "plan",
        "command",
        "error",
        "fileChange",
        "message",
        "turn",
        "message",
        "message",
        "turn",
      ]);
      expect(session?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "command",
            command: "pnpm test",
            status: "failed",
            toolUseId: "tool-2",
            output: "command failed",
          }),
          expect.objectContaining({
            type: "fileChange",
            path: "src/server.ts",
            status: "completed",
            toolUseId: "tool-3",
            output: "File updated",
          }),
        ]),
      );
      expect(
        session?.events.filter((event) => event.type === "turn" && event.status === "completed"),
      ).toHaveLength(2);
      expect(
        session?.events.some(
          (event) => event.type === "tool" && (event.name === "Bash" || event.name === "Edit"),
        ),
      ).toBe(false);
      expect(session?.diagnostics).toEqual([
        expect.objectContaining({ kind: "malformed", line: 14 }),
        expect.objectContaining({ kind: "unknown", line: 15, recordType: "future-claude-record" }),
      ]);

      const visible = NodeUtil.inspect({ candidate: session?.candidate, events: session?.events });
      expect(visible).not.toContain("HIDDEN_SYSTEM_CONTEXT");
      expect(visible).not.toContain("ANTHROPIC_API_KEY");
      expect(visible).not.toContain("HIDDEN_QUEUE_BOOKKEEPING");
      expect(visible).not.toContain("UNKNOWN_SECRET_PAYLOAD");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("excludes Claude sidechain and nested subagent transcripts as candidates", () =>
    Effect.gen(function* () {
      const sessions = yield* scanClaudeExternalChats({
        homeRoot: claudeHomeRoot,
        providerInstanceId: ProviderInstanceId.make("claude_work"),
      });

      expect(sessions.map((session) => session.candidate.nativeSessionId)).toEqual([
        "8dcd1b39-8e74-41f0-a07c-b876917a46c4",
      ]);
      expect(sessions.map((session) => session.candidate.nativeSessionId)).not.toContain(
        "5f482086-5420-4ff7-b81e-7fb2b8df8969",
      );
      expect(sessions[0]?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "message", text: "Add import support" }),
        ]),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("marks Claude session IDs rejected by the runtime as not resumable", () =>
    Effect.gen(function* () {
      const homeRoot = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-claude-invalid-")),
      );
      const projectRoot = NodePath.join(homeRoot, "projects", "-workspace-invalid");
      yield* Effect.promise(() => NodeFSP.mkdir(projectRoot, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(projectRoot, "invalid.jsonl"),
          '{"type":"user","uuid":"user-1","sessionId":"not-a-runtime-uuid","timestamp":"2026-07-20T11:00:00.000Z","cwd":"/workspace/invalid","message":{"role":"user","content":"Keep this history readable"}}\n',
        ),
      );

      const [session] = yield* scanClaudeExternalChats({
        homeRoot,
        providerInstanceId: ProviderInstanceId.make("claude_work"),
      });

      expect(session?.candidate.resumability).toEqual({
        status: "not_resumable",
        reason: "Native session ID is incompatible with the provider runtime.",
      });
      yield* Effect.promise(() => NodeFSP.rm(homeRoot, { recursive: true, force: true }));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("derives instance-isolated stable opaque candidate IDs", () =>
    Effect.gen(function* () {
      const [first] = yield* scanCodexExternalChats({
        homeRoot: codexHomeRoot,
        providerInstanceId: ProviderInstanceId.make("codex_personal"),
      });
      const [repeat] = yield* scanCodexExternalChats({
        homeRoot: codexHomeRoot,
        providerInstanceId: ProviderInstanceId.make("codex_personal"),
      });
      const [otherInstance] = yield* scanCodexExternalChats({
        homeRoot: codexHomeRoot,
        providerInstanceId: ProviderInstanceId.make("codex_work"),
      });

      expect(first?.candidate.candidateId).toMatch(/^extchat_v1_[a-f0-9]{64}$/);
      expect(repeat?.candidate.candidateId).toBe(first?.candidate.candidateId);
      expect(otherInstance?.candidate.candidateId).not.toBe(first?.candidate.candidateId);
      expect(first?.candidate.candidateId).not.toContain(first?.sourceFile ?? "");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "uses only configured roots, combines sources by recency, and never mutates fixtures",
    () =>
      Effect.gen(function* () {
        const before = yield* Effect.promise(() =>
          NodeFSP.readFile(fixturesRoot + "/codex/sessions/2026/07/20/rollout-alpha.jsonl", "utf8"),
        );
        const sessions = yield* scanExternalChats({
          sources: [
            {
              source: "codex",
              homeRoot: codexHomeRoot,
              providerInstanceId: ProviderInstanceId.make("codex_work"),
            },
            {
              source: "claude",
              homeRoot: claudeHomeRoot,
              providerInstanceId: ProviderInstanceId.make("claude_work"),
            },
          ],
        });
        const after = yield* Effect.promise(() =>
          NodeFSP.readFile(fixturesRoot + "/codex/sessions/2026/07/20/rollout-alpha.jsonl", "utf8"),
        );

        expect(sessions.map((session) => session.candidate.source)).toEqual([
          "claude",
          "codex",
          "codex",
        ]);
        expect(after).toBe(before);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
