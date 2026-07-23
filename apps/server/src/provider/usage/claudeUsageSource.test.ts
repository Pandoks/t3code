import { expect, it } from "@effect/vitest";

import { claudeCredentialPaths } from "./claudeUsageSource.ts";

it("keeps custom Claude homes isolated from the default account credentials", () => {
  expect(claudeCredentialPaths("/custom/.claude")).toEqual(["/custom/.claude/.credentials.json"]);
  expect(claudeCredentialPaths("/Users/test/.claude")).toEqual([
    "/Users/test/.claude/.credentials.json",
  ]);
});
