// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import {
  ExternalChatCandidateId,
  ExternalChatNativeSessionId,
  type ExternalChatCandidate,
  type ExternalChatSource,
  type NormalizedHistoricalEvent,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface ExternalChatDiagnostic {
  readonly kind: "malformed" | "unknown";
  readonly line: number;
  readonly recordType?: string;
  readonly message: string;
}

export interface NativeExternalChat {
  readonly candidate: ExternalChatCandidate;
  readonly sourceFile: string;
  readonly events: ReadonlyArray<NormalizedHistoricalEvent>;
  readonly diagnostics: ReadonlyArray<ExternalChatDiagnostic>;
}

export interface ExternalChatScannerInput {
  readonly homeRoot: string;
  readonly providerInstanceId: ProviderInstanceId;
}

export interface ExternalChatSourceConfig extends ExternalChatScannerInput {
  readonly source: ExternalChatSource;
}

export class ExternalChatScanError extends Schema.TaggedErrorClass<ExternalChatScanError>()(
  "ExternalChatScanError",
  {
    source: Schema.Literals(["codex", "claude"]),
    homeRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {}

type JsonRecord = Record<string, unknown>;

interface ParsedLine {
  readonly line: number;
  readonly timestamp?: string;
  readonly record: JsonRecord;
}

interface TimestampedEvent {
  readonly order: number;
  readonly event: NormalizedHistoricalEvent;
}

type HistoricalEventWithoutTimestamp = NormalizedHistoricalEvent extends infer Event
  ? Event extends NormalizedHistoricalEvent
    ? Omit<Event, "timestamp">
    : never
  : never;

interface ParsedTranscript {
  readonly nativeSessionId: string;
  readonly cwd?: string;
  readonly title?: string;
  readonly events: ReadonlyArray<NormalizedHistoricalEvent>;
  readonly diagnostics: ReadonlyArray<ExternalChatDiagnostic>;
  readonly timestamps: ReadonlyArray<string>;
  readonly hasNativeMetadata: boolean;
  readonly isSidechain: boolean;
}

type ClaudeToolCall =
  | {
      readonly kind: "command";
      readonly name: string;
      readonly command: string;
    }
  | {
      readonly kind: "fileChange";
      readonly name: string;
      readonly path?: string;
      readonly patch?: string;
    }
  | {
      readonly kind: "tool";
      readonly name: string;
    };

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const jsonSummary = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const normalizeStatus = (value: unknown): "started" | "completed" | "failed" | "unknown" => {
  if (value === "in_progress" || value === "started" || value === "running") return "started";
  if (value === "completed" || value === "success" || value === "succeeded") return "completed";
  if (value === "failed" || value === "declined" || value === "error") return "failed";
  return "unknown";
};

const makeCandidateId = (
  source: ExternalChatSource,
  providerInstanceId: ProviderInstanceId,
  nativeSessionId: string,
) =>
  ExternalChatCandidateId.make(
    `extchat_v1_${createHash("sha256")
      .update(`${source}\0${providerInstanceId}\0${nativeSessionId}`)
      .digest("hex")}`,
  );

const parseJsonl = (
  contents: string,
): {
  readonly lines: ReadonlyArray<ParsedLine>;
  readonly diagnostics: Array<ExternalChatDiagnostic>;
} => {
  const lines: Array<ParsedLine> = [];
  const diagnostics: Array<ExternalChatDiagnostic> = [];
  for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
    if (rawLine.trim().length === 0) continue;
    try {
      const record = asRecord(JSON.parse(rawLine));
      if (!record) throw new Error("JSONL record is not an object");
      const timestamp = asString(record.timestamp);
      lines.push({
        line: index + 1,
        record,
        ...(timestamp ? { timestamp } : {}),
      });
    } catch {
      diagnostics.push({
        kind: "malformed",
        line: index + 1,
        message: "Malformed JSONL record was skipped.",
      });
    }
  }
  return { lines, diagnostics };
};

const textFromContent = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((item) => {
    const block = asRecord(item);
    if (!block) return [];
    const type = asString(block.type);
    if (type !== "input_text" && type !== "output_text" && type !== "text") return [];
    const text = asString(block.text);
    return text ? [text] : [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
};

const addEvent = (
  target: Array<TimestampedEvent>,
  order: number,
  timestamp: string | undefined,
  event: HistoricalEventWithoutTimestamp,
) => {
  target.push({
    order,
    event: {
      ...event,
      ...(timestamp ? { timestamp } : {}),
    } as NormalizedHistoricalEvent,
  });
};

const sortEvents = (events: ReadonlyArray<TimestampedEvent>) =>
  [...events]
    .sort((left, right) => {
      const timestampOrder = (left.event.timestamp ?? "").localeCompare(
        right.event.timestamp ?? "",
      );
      return timestampOrder === 0 ? left.order - right.order : timestampOrder;
    })
    .map(({ event }) => event);

const pushMessage = (
  events: Array<TimestampedEvent>,
  seenMessages: Set<string>,
  order: number,
  timestamp: string | undefined,
  role: "user" | "assistant",
  text: string | undefined,
) => {
  if (!text) return;
  const key = `${role}\0${text}\0${timestamp ?? order}`;
  if (seenMessages.has(key)) return;
  seenMessages.add(key);
  addEvent(events, order, timestamp, { type: "message", role, text });
};

const codexHiddenEventTypes = new Set([
  "token_count",
  "task_started",
  "turn_started",
  "session_configured",
  "context_compacted",
  "thread_name_updated",
  "shutdown_complete",
]);

const codexToolEventNames: Record<string, string> = {
  mcp_tool_call_begin: "MCP tool",
  mcp_tool_call_end: "MCP tool",
  dynamic_tool_call_request: "Dynamic tool",
  dynamic_tool_call_response: "Dynamic tool",
  web_search_begin: "Web search",
  web_search_end: "Web search",
  view_image_tool_call: "View image",
};

const parseCodexTranscript = (contents: string, sourceFile: string): ParsedTranscript => {
  const parsed = parseJsonl(contents);
  const diagnostics = [...parsed.diagnostics];
  const events: Array<TimestampedEvent> = [];
  const seenMessages = new Set<string>();
  const customToolNames = new Map<string, string>();
  const timestamps: Array<string> = [];
  let nativeSessionId = NodePath.basename(sourceFile, ".jsonl");
  let cwd: string | undefined;
  let title: string | undefined;
  let hasNativeMetadata = false;

  for (const line of parsed.lines) {
    if (line.timestamp) timestamps.push(line.timestamp);
    const type = asString(line.record.type);
    const payload = asRecord(line.record.payload);
    if (type === "session_meta" && payload) {
      hasNativeMetadata = true;
      nativeSessionId = asString(payload.id) ?? asString(payload.session_id) ?? nativeSessionId;
      cwd = asString(payload.cwd) ?? cwd;
      const metadataTimestamp = asString(payload.timestamp);
      if (metadataTimestamp) timestamps.push(metadataTimestamp);
      continue;
    }
    if (type === "turn_context" || type === "compacted" || type === "world_state") continue;
    if (type === "response_item" && payload) {
      const itemType = asString(payload.type);
      if (itemType === "message") {
        const role = asString(payload.role);
        if (role === "user" || role === "assistant") {
          pushMessage(
            events,
            seenMessages,
            line.line,
            line.timestamp,
            role,
            textFromContent(payload.content),
          );
        }
        continue;
      }
      if (itemType === "function_call") {
        const summary = asString(payload.arguments);
        addEvent(events, line.line, line.timestamp, {
          type: "tool",
          name: asString(payload.name) ?? "Tool",
          status: "started",
          ...(summary ? { summary } : {}),
        });
        continue;
      }
      if (itemType === "custom_tool_call") {
        const callId = asString(payload.call_id);
        const name = asString(payload.name) ?? "Custom tool";
        const summary = asString(payload.input);
        if (callId) customToolNames.set(callId, name);
        addEvent(events, line.line, line.timestamp, {
          type: "tool",
          name,
          status: normalizeStatus(payload.status),
          ...(callId ? { toolUseId: callId } : {}),
          ...(summary ? { summary } : {}),
        });
        continue;
      }
      if (itemType === "custom_tool_call_output") {
        const callId = asString(payload.call_id);
        const name =
          asString(payload.name) ??
          (callId ? customToolNames.get(callId) : undefined) ??
          "Custom tool";
        const summary = jsonSummary(payload.output);
        addEvent(events, line.line, line.timestamp, {
          type: "tool",
          name,
          status: "completed",
          ...(callId ? { toolUseId: callId } : {}),
          ...(summary ? { summary } : {}),
        });
        continue;
      }
      if (itemType === "local_shell_call") {
        const action = asRecord(payload.action);
        addEvent(events, line.line, line.timestamp, {
          type: "command",
          command:
            asString(action?.command) ??
            (Array.isArray(action?.command) ? action.command.map(String).join(" ") : ""),
          status: normalizeStatus(payload.status),
        });
        continue;
      }
      if (itemType === "reasoning" || itemType === "function_call_output") {
        continue;
      }
      diagnostics.push({
        kind: "unknown",
        line: line.line,
        ...(itemType ? { recordType: `response_item:${itemType}` } : {}),
        message: "Unknown Codex response item was retained as a diagnostic.",
      });
      continue;
    }
    if (type === "event_msg" && payload) {
      const eventType = asString(payload.type);
      if (eventType === "user_message" || eventType === "agent_message") {
        pushMessage(
          events,
          seenMessages,
          line.line,
          line.timestamp,
          eventType === "user_message" ? "user" : "assistant",
          asString(payload.message),
        );
        continue;
      }
      if (eventType === "exec_command_begin" || eventType === "exec_command_end") {
        const command = Array.isArray(payload.command)
          ? payload.command.map(String).join(" ")
          : (asString(payload.command) ?? "");
        const output = [asString(payload.stdout), asString(payload.stderr)]
          .filter(Boolean)
          .join("\n");
        const exitCode = asNumber(payload.exit_code);
        addEvent(events, line.line, line.timestamp, {
          type: "command",
          command,
          status: eventType === "exec_command_begin" ? "started" : normalizeStatus(payload.status),
          ...(output ? { output } : {}),
          ...(exitCode !== undefined ? { exitCode } : {}),
        });
        continue;
      }
      if (eventType === "patch_apply_begin" || eventType === "patch_apply_end") {
        const changes = asRecord(payload.changes) ?? {};
        for (const [path, rawChange] of Object.entries(changes)) {
          const change = asRecord(rawChange);
          const update = asRecord(change?.update);
          const patch = asString(update?.unified_diff) ?? asString(change?.unified_diff);
          addEvent(events, line.line, line.timestamp, {
            type: "fileChange",
            path,
            ...(patch ? { patch } : {}),
            status:
              eventType === "patch_apply_begin"
                ? "started"
                : payload.success === false
                  ? "failed"
                  : "completed",
          });
        }
        continue;
      }
      if (eventType === "plan_update") {
        const steps = Array.isArray(payload.plan)
          ? payload.plan.flatMap((rawStep) => {
              const step = asRecord(rawStep);
              const text = asString(step?.step);
              return text ? [`${asString(step?.status) ?? "pending"}: ${text}`] : [];
            })
          : [];
        addEvent(events, line.line, line.timestamp, {
          type: "plan",
          text: steps.join("\n") || asString(payload.explanation) || "Plan updated",
        });
        continue;
      }
      if (eventType === "error" || eventType === "stream_error") {
        addEvent(events, line.line, line.timestamp, {
          type: "error",
          message: asString(payload.message) ?? "Codex turn error",
        });
        continue;
      }
      if (eventType === "task_complete" || eventType === "turn_complete") {
        addEvent(events, line.line, line.timestamp, { type: "turn", status: "completed" });
        continue;
      }
      if (eventType === "turn_aborted") {
        const reason = asString(payload.reason);
        addEvent(events, line.line, line.timestamp, {
          type: "turn",
          status: "interrupted",
          ...(reason ? { reason } : {}),
        });
        continue;
      }
      if (eventType && codexToolEventNames[eventType]) {
        addEvent(events, line.line, line.timestamp, {
          type: "tool",
          name: codexToolEventNames[eventType],
          status:
            eventType.endsWith("_begin") || eventType.endsWith("_request")
              ? "started"
              : "completed",
        });
        continue;
      }
      if (eventType && codexHiddenEventTypes.has(eventType)) {
        title = asString(payload.thread_name) ?? asString(payload.name) ?? title;
        continue;
      }
      diagnostics.push({
        kind: "unknown",
        line: line.line,
        ...(eventType ? { recordType: `event_msg:${eventType}` } : {}),
        message: "Unknown Codex event was retained as a diagnostic.",
      });
      continue;
    }
    diagnostics.push({
      kind: "unknown",
      line: line.line,
      ...(type ? { recordType: type } : {}),
      message: "Unknown Codex record was retained as a diagnostic.",
    });
  }

  return {
    nativeSessionId,
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    events: sortEvents(events),
    diagnostics,
    timestamps,
    hasNativeMetadata,
    isSidechain: false,
  };
};

const claudeHiddenRecordTypes = new Set([
  "file-history-snapshot",
  "queue-operation",
  "progress",
  "attachment",
  "agent-name",
  "permission-mode",
  "last-prompt",
  "summary",
]);

const claudePlanText = (input: JsonRecord): string => {
  if (Array.isArray(input.todos)) {
    const steps = input.todos.flatMap((rawTodo) => {
      const todo = asRecord(rawTodo);
      const content = asString(todo?.content);
      return content ? [`${asString(todo?.status) ?? "pending"}: ${content}`] : [];
    });
    if (steps.length > 0) return steps.join("\n");
  }
  return asString(input.plan) ?? "Plan updated";
};

const parseClaudeTranscript = (contents: string, sourceFile: string): ParsedTranscript => {
  const parsed = parseJsonl(contents);
  const diagnostics = [...parsed.diagnostics];
  const events: Array<TimestampedEvent> = [];
  const seenMessages = new Set<string>();
  const toolCalls = new Map<string, ClaudeToolCall>();
  const timestamps: Array<string> = [];
  let nativeSessionId = NodePath.basename(sourceFile, ".jsonl");
  let cwd: string | undefined;
  let title: string | undefined;
  let hasNativeMetadata = false;
  let isSidechain = false;

  for (const line of parsed.lines) {
    if (line.timestamp) timestamps.push(line.timestamp);
    const type = asString(line.record.type);
    nativeSessionId =
      asString(line.record.sessionId) ?? asString(line.record.session_id) ?? nativeSessionId;
    cwd = asString(line.record.cwd) ?? cwd;
    isSidechain =
      isSidechain || line.record.isSidechain === true || line.record.is_sidechain === true;
    if (asString(line.record.sessionId) || asString(line.record.session_id))
      hasNativeMetadata = true;

    if (type === "custom-title") {
      title = asString(line.record.customTitle) ?? asString(line.record.title) ?? title;
      continue;
    }
    if (type === "system") continue;
    if (type === "user" || type === "assistant") {
      const message = asRecord(line.record.message);
      const content = message?.content;
      if (type === "user") {
        pushMessage(
          events,
          seenMessages,
          line.line,
          line.timestamp,
          "user",
          textFromContent(content),
        );
      } else {
        pushMessage(
          events,
          seenMessages,
          line.line,
          line.timestamp,
          "assistant",
          textFromContent(content),
        );
      }

      if (Array.isArray(content)) {
        for (const [blockIndex, rawBlock] of content.entries()) {
          const block = asRecord(rawBlock);
          const blockType = asString(block?.type);
          const eventOrder = line.line * 100 + blockIndex;
          if (blockType === "tool_use" && block) {
            const name = asString(block.name) ?? "Tool";
            const input = asRecord(block.input) ?? {};
            const toolUseId = asString(block.id);
            if (["Bash", "Shell", "Terminal"].includes(name)) {
              const command = asString(input.command) ?? "";
              if (toolUseId) toolCalls.set(toolUseId, { kind: "command", name, command });
              addEvent(events, eventOrder, line.timestamp, {
                type: "command",
                command,
                status: "started",
                ...(toolUseId ? { toolUseId } : {}),
              });
            } else if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(name)) {
              const path = asString(input.file_path);
              const patch =
                asString(input.old_string) || asString(input.new_string)
                  ? `${asString(input.old_string) ?? ""}\n${asString(input.new_string) ?? ""}`
                  : undefined;
              if (toolUseId) {
                toolCalls.set(toolUseId, {
                  kind: "fileChange",
                  name,
                  ...(path ? { path } : {}),
                  ...(patch ? { patch } : {}),
                });
              }
              addEvent(events, eventOrder, line.timestamp, {
                type: "fileChange",
                ...(path ? { path } : {}),
                ...(patch ? { patch } : {}),
                status: "started",
                ...(toolUseId ? { toolUseId } : {}),
              });
            } else if (["TodoWrite", "EnterPlanMode", "ExitPlanMode"].includes(name)) {
              if (toolUseId) toolCalls.set(toolUseId, { kind: "tool", name });
              addEvent(events, eventOrder, line.timestamp, {
                type: "plan",
                text: claudePlanText(input),
              });
            } else {
              const summary = jsonSummary(input);
              if (toolUseId) toolCalls.set(toolUseId, { kind: "tool", name });
              addEvent(events, eventOrder, line.timestamp, {
                type: "tool",
                name,
                status: "started",
                ...(toolUseId ? { toolUseId } : {}),
                ...(summary ? { summary } : {}),
              });
            }
          }
          if (blockType === "tool_result" && block) {
            const toolUseId = asString(block.tool_use_id);
            const failed = block.is_error === true;
            const summary = jsonSummary(block.content);
            const toolCall = toolUseId ? toolCalls.get(toolUseId) : undefined;
            if (toolCall?.kind === "command") {
              addEvent(events, eventOrder, line.timestamp, {
                type: "command",
                command: toolCall.command,
                status: failed ? "failed" : "completed",
                ...(toolUseId ? { toolUseId } : {}),
                ...(summary ? { output: summary } : {}),
              });
            } else if (toolCall?.kind === "fileChange") {
              addEvent(events, eventOrder, line.timestamp, {
                type: "fileChange",
                ...(toolCall.path ? { path: toolCall.path } : {}),
                ...(toolCall.patch ? { patch: toolCall.patch } : {}),
                status: failed ? "failed" : "completed",
                ...(toolUseId ? { toolUseId } : {}),
                ...(summary ? { output: summary } : {}),
              });
            } else {
              addEvent(events, eventOrder, line.timestamp, {
                type: "tool",
                name: toolCall?.name ?? "Tool",
                status: failed ? "failed" : "completed",
                ...(toolUseId ? { toolUseId } : {}),
                ...(summary ? { summary } : {}),
              });
            }
            if (failed) {
              addEvent(events, eventOrder + 1, line.timestamp, {
                type: "error",
                message: summary ?? "Claude tool failed",
              });
            }
          }
        }
      }

      if (type === "assistant" && asString(message?.stop_reason) === "end_turn") {
        addEvent(events, line.line * 100 + 99, line.timestamp, {
          type: "turn",
          status: "completed",
        });
      }
      if (line.record.isInterrupt === true || line.record.is_interrupt === true) {
        addEvent(events, line.line * 100 + 99, line.timestamp, {
          type: "turn",
          status: "interrupted",
          reason: "interrupted",
        });
      }
      continue;
    }
    if (type && claudeHiddenRecordTypes.has(type)) continue;
    diagnostics.push({
      kind: "unknown",
      line: line.line,
      ...(type ? { recordType: type } : {}),
      message: "Unknown Claude record was retained as a diagnostic.",
    });
  }

  return {
    nativeSessionId,
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    events: sortEvents(events),
    diagnostics,
    timestamps,
    hasNativeMetadata,
    isSidechain,
  };
};

const firstMessage = (
  events: ReadonlyArray<NormalizedHistoricalEvent>,
  role?: "user" | "assistant",
) =>
  events.find(
    (event): event is Extract<NormalizedHistoricalEvent, { readonly type: "message" }> =>
      event.type === "message" && (!role || event.role === role),
  )?.text;

const titleFromMessage = (message: string | undefined) => {
  const title = message?.split(/\r?\n/u)[0]?.trim();
  if (!title) return undefined;
  return title.length <= 80 ? title : `${title.slice(0, 77)}...`;
};

const previewFromMessage = (message: string | undefined) => {
  const preview = message?.trim() ?? "";
  return preview.length <= 160 ? preview : `${preview.slice(0, 157)}...`;
};

const discoverJsonlFiles = Effect.fn("ExternalChatCatalog.discoverJsonlFiles")(function* (
  source: ExternalChatSource,
  homeRoot: string,
) {
  const searchRoot = NodePath.join(homeRoot, source === "codex" ? "sessions" : "projects");
  return yield* Effect.tryPromise({
    try: async () => {
      try {
        const entries = await NodeFS.readdir(searchRoot, { recursive: true, withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
          .map((entry) => NodePath.join(entry.parentPath, entry.name))
          .filter((filePath) => {
            if (source !== "claude") return true;
            const relativeParts = NodePath.relative(searchRoot, filePath)
              .split(NodePath.sep)
              .filter(Boolean);
            return relativeParts.length === 2;
          })
          .sort();
      } catch (cause) {
        if (asRecord(cause)?.code === "ENOENT") return [];
        throw cause;
      }
    },
    catch: (cause) => new ExternalChatScanError({ source, homeRoot, cause }),
  });
});

const scanSource = Effect.fn("ExternalChatCatalog.scanSource")(function* (
  source: ExternalChatSource,
  input: ExternalChatScannerInput,
) {
  const files = yield* discoverJsonlFiles(source, input.homeRoot);
  const sessions: Array<NativeExternalChat> = [];
  for (const sourceFile of files) {
    const { contents, stat } = yield* Effect.tryPromise({
      try: async () => ({
        contents: await NodeFS.readFile(sourceFile, "utf8"),
        stat: await NodeFS.stat(sourceFile),
      }),
      catch: (cause) => new ExternalChatScanError({ source, homeRoot: input.homeRoot, cause }),
    });
    const parsed =
      source === "codex"
        ? parseCodexTranscript(contents, sourceFile)
        : parseClaudeTranscript(contents, sourceFile);
    if (source === "claude" && parsed.isSidechain) continue;
    const sortedTimestamps = [...parsed.timestamps].sort();
    const createdAt = sortedTimestamps[0] ?? stat.birthtime.toISOString();
    const updatedAt = sortedTimestamps.at(-1) ?? stat.mtime.toISOString();
    const firstUserMessage = firstMessage(parsed.events, "user");
    const firstVisibleMessage = firstMessage(parsed.events);
    const resumable = parsed.hasNativeMetadata && parsed.cwd !== undefined;
    const candidate: ExternalChatCandidate = {
      source,
      candidateId: makeCandidateId(source, input.providerInstanceId, parsed.nativeSessionId),
      providerInstanceId: input.providerInstanceId,
      nativeSessionId: ExternalChatNativeSessionId.make(parsed.nativeSessionId),
      ...(parsed.cwd ? { cwd: parsed.cwd, projectPath: parsed.cwd } : {}),
      title:
        parsed.title ??
        titleFromMessage(firstUserMessage ?? firstVisibleMessage) ??
        `${source === "codex" ? "Codex" : "Claude"} session`,
      preview: previewFromMessage(firstUserMessage ?? firstVisibleMessage),
      createdAt,
      updatedAt,
      messageCount: parsed.events.filter((event) => event.type === "message").length,
      resumability: resumable
        ? { status: "resumable" }
        : {
            status: parsed.hasNativeMetadata ? "unknown" : "not_resumable",
            reason: parsed.hasNativeMetadata
              ? "Working directory unavailable."
              : "Native session metadata unavailable.",
          },
    };
    sessions.push({
      candidate,
      sourceFile,
      events: parsed.events,
      diagnostics: parsed.diagnostics,
    });
  }
  return sessions.sort((left, right) =>
    right.candidate.updatedAt.localeCompare(left.candidate.updatedAt),
  );
});

export const scanCodexExternalChats = Effect.fn("ExternalChatCatalog.scanCodexExternalChats")(
  function* (input: ExternalChatScannerInput) {
    return yield* scanSource("codex", input);
  },
);

export const scanClaudeExternalChats = Effect.fn("ExternalChatCatalog.scanClaudeExternalChats")(
  function* (input: ExternalChatScannerInput) {
    return yield* scanSource("claude", input);
  },
);

export const scanExternalChats = Effect.fn("ExternalChatCatalog.scanExternalChats")(
  function* (input: { readonly sources: ReadonlyArray<ExternalChatSourceConfig> }) {
    const sessions = yield* Effect.forEach(input.sources, (config) =>
      scanSource(config.source, config),
    );
    return sessions
      .flat()
      .sort((left, right) => right.candidate.updatedAt.localeCompare(left.candidate.updatedAt));
  },
);
