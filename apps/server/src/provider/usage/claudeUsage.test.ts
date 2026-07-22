import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { parseClaudeUsageScreen, renderAnsiTerminal } from "./claudeUsage.ts";

const SCREEN = `
Current session
████████░░ 78% used
Resets 4pm (America/Los_Angeles)

Current week (all models)
████░░░░░░ 42% used
Resets Jul 25 at 11:30pm (America/Los_Angeles)

Current week (Sonnet only)
██░░░░░░░░ 20% used
Resets Jul 26 at 12am (America/Los_Angeles)
`;

describe("Claude native usage", () => {
  it("parses session and weekly windows with a current-session headline", () => {
    const parsed = parseClaudeUsageScreen(SCREEN, DateTime.makeUnsafe("2026-07-22T12:00:00.000Z"));

    expect(parsed.headlineWindowId).toBe("session");
    expect(
      parsed.windows.map(({ id, label, usedPercent, windowDurationMinutes }) => ({
        id,
        label,
        usedPercent,
        windowDurationMinutes,
      })),
    ).toEqual([
      { id: "session", label: "Current session", usedPercent: 78, windowDurationMinutes: 300 },
      {
        id: "week",
        label: "Current week (all models)",
        usedPercent: 42,
        windowDurationMinutes: 10_080,
      },
      {
        id: "week-sonnet",
        label: "Current week (Sonnet only)",
        usedPercent: 20,
        windowDurationMinutes: 10_080,
      },
    ]);
    expect(parsed.windows.every((window) => window.resetsAt.includes("T"))).toBe(true);
  });

  it("reconstructs the terminal screen from cursor-positioned ANSI updates", () => {
    expect(renderAnsiTerminal("hello\u001b[2J\u001b[HCurrent session\r\n50% used").trim()).toBe(
      "Current session\n50% used",
    );
  });
});
