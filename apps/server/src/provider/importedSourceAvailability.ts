// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as Effect from "effect/Effect";

import { ProviderValidationError } from "./Errors.ts";

function readImportedSourceFile(runtimePayload: unknown): string | undefined {
  if (
    typeof runtimePayload !== "object" ||
    runtimePayload === null ||
    Array.isArray(runtimePayload)
  ) {
    return undefined;
  }
  const externalChat = "externalChat" in runtimePayload ? runtimePayload.externalChat : undefined;
  if (typeof externalChat !== "object" || externalChat === null || Array.isArray(externalChat)) {
    return undefined;
  }
  const sourceFile = "sourceFile" in externalChat ? externalChat.sourceFile : undefined;
  return typeof sourceFile === "string" && sourceFile.trim().length > 0 ? sourceFile : undefined;
}

export const validateImportedSourceAvailability = Effect.fn("validateImportedSourceAvailability")(
  function* (input: {
    readonly operation: string;
    readonly threadId: string;
    readonly runtimePayload: unknown;
  }) {
    const sourceFile = readImportedSourceFile(input.runtimePayload);
    if (sourceFile === undefined || NodeFS.existsSync(sourceFile)) return;
    return yield* new ProviderValidationError({
      operation: input.operation,
      issue: `Cannot continue imported thread '${input.threadId}' because its native source is no longer available. The imported history remains readable.`,
    });
  },
);
