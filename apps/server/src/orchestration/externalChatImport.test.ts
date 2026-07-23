import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

it.layer(NodeServices.layer)("external chat import command", (it) => {
  it.effect("appends historical user text without requesting a provider turn", () =>
    Effect.gen(function* () {
      const now = "2026-07-21T00:00:00.000Z";
      let model = createEmptyReadModel(now);
      model = yield* projectEvent(model, {
        sequence: 1,
        eventId: EventId.make("evt-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-import"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-import"),
          title: "Import",
          workspaceRoot: "/workspace/import",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      model = yield* projectEvent(model, {
        sequence: 2,
        eventId: EventId.make("evt-thread"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-import"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-import"),
          projectId: ProjectId.make("project-import"),
          title: "Import",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex_work"),
            model: "gpt-5.6-sol",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const decided = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "thread.message.history.append",
          commandId: CommandId.make("cmd-history"),
          threadId: ThreadId.make("thread-import"),
          messageId: MessageId.make("message-native-1"),
          role: "user",
          text: "Historical prompt",
          createdAt: now,
        },
      });

      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual(["thread.message-sent"]);
      expect(events[0]?.payload).toMatchObject({
        role: "user",
        text: "Historical prompt",
        turnId: null,
        streaming: false,
      });
    }),
  );
});
