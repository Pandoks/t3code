// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  scanClaudeExternalChats,
  scanCodexExternalChats,
  scanExternalChats,
} from "./ExternalChatCatalog.ts";

const fixturesRoot = fileURLToPath(new URL("./__fixtures__", import.meta.url));
const codexHomeRoot = fileURLToPath(new URL("./__fixtures__/codex", import.meta.url));
const claudeHomeRoot = fileURLToPath(new URL("./__fixtures__/claude", import.meta.url));

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
        messageCount: 2,
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
        "error",
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
        ]),
      );
      expect(session?.events.map((event) => event.timestamp)).toEqual(
        [...(session?.events ?? [])]
          .map((event) => event.timestamp)
          .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
      );
      expect(session?.diagnostics).toEqual([
        expect.objectContaining({ kind: "malformed", line: 15 }),
        expect.objectContaining({ kind: "unknown", line: 16, recordType: "future_native_record" }),
      ]);

      const visible = inspect({ candidate: session?.candidate, events: session?.events });
      expect(visible).not.toContain("HIDDEN_SYSTEM_PROMPT");
      expect(visible).not.toContain("HIDDEN_DEVELOPER_PROMPT");
      expect(visible).not.toContain("SUPER_SECRET_TOKEN");
      expect(visible).not.toContain("UNKNOWN_SECRET_PAYLOAD");
    }).pipe(Effect.provide(NodeServices.layer)),
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
        nativeSessionId: "claude-session-beta",
        cwd: "/workspace/beta",
        projectPath: "/workspace/beta",
        title: "External chat import",
        preview: "Add import support",
        createdAt: "2026-07-20T11:00:00.000Z",
        updatedAt: "2026-07-20T11:00:09.000Z",
        messageCount: 3,
        resumability: { status: "resumable" },
      });
      expect(session?.events.map((event) => event.type)).toEqual([
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
      ).toHaveLength(1);
      expect(
        session?.events.some(
          (event) => event.type === "tool" && (event.name === "Bash" || event.name === "Edit"),
        ),
      ).toBe(false);
      expect(session?.diagnostics).toEqual([
        expect.objectContaining({ kind: "malformed", line: 10 }),
        expect.objectContaining({ kind: "unknown", line: 11, recordType: "future-claude-record" }),
      ]);

      const visible = inspect({ candidate: session?.candidate, events: session?.events });
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
        "claude-session-beta",
      ]);
      expect(sessions[0]?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "message", text: "Add import support" }),
        ]),
      );
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
          NodeFS.readFile(fixturesRoot + "/codex/sessions/2026/07/20/rollout-alpha.jsonl", "utf8"),
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
          NodeFS.readFile(fixturesRoot + "/codex/sessions/2026/07/20/rollout-alpha.jsonl", "utf8"),
        );

        expect(sessions.map((session) => session.candidate.source)).toEqual(["claude", "codex"]);
        expect(after).toBe(before);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
