import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { validateImportedSourceAvailability } from "./importedSourceAvailability.ts";

it.effect("rejects continuation when an imported native source is missing", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      validateImportedSourceAvailability({
        operation: "ProviderService.startSession",
        threadId: "thread-imported",
        runtimePayload: {
          externalChat: {
            sourceFile: "/definitely/missing/native-session.jsonl",
          },
        },
      }),
    );
    assert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.match(result.failure.issue, /native source.*no longer available/i);
    }
  }),
);

it.effect("leaves ordinary T3 sessions unchanged", () =>
  validateImportedSourceAvailability({
    operation: "ProviderService.startSession",
    threadId: "thread-ordinary",
    runtimePayload: { cwd: "/tmp/project" },
  }),
);
