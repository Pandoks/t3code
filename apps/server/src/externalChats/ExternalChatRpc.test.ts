import { ExternalChatCandidateId, WS_METHODS } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeExternalChatRpcHandlers } from "./ExternalChatRpc.ts";

it.effect("routes list, refresh, and import RPC payloads to the service", () =>
  Effect.gen(function* () {
    const calls: Array<string> = [];
    const handlers = makeExternalChatRpcHandlers({
      list: (request) =>
        Effect.sync(() => {
          calls.push(`list:${request.sources?.join(",") ?? "all"}`);
          return { candidates: [] };
        }),
      refresh: () =>
        Effect.sync(() => {
          calls.push("refresh");
          return { candidates: [], refreshedAt: "2026-07-21T00:00:00.000Z" };
        }),
      import: (request) =>
        Effect.sync(() => {
          calls.push(`import:${request.candidateIds.join(",")}`);
          return { results: [] };
        }),
    });

    yield* handlers[WS_METHODS.externalChatsList]({ sources: ["codex"] });
    yield* handlers[WS_METHODS.externalChatsRefresh]({});
    yield* handlers[WS_METHODS.externalChatsImport]({
      candidateIds: [ExternalChatCandidateId.make("candidate-1")],
    });

    assert.deepEqual(calls, ["list:codex", "refresh", "import:candidate-1"]);
  }),
);
