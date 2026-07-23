import { describe, expect, it } from "@effect/vitest";

import { parseClaudeOAuthUsage } from "./claudeOAuthUsage.ts";

describe("Claude OAuth usage", () => {
  it("normalizes session, weekly, routines, and scoped model windows", () => {
    const result = parseClaudeOAuthUsage({
      five_hour: { utilization: 25, resets_at: "2026-07-23T03:39:59Z" },
      seven_day: { utilization: 40, resets_at: "2026-07-26T05:59:59Z" },
      seven_day_routines: { utilization: 0, resets_at: "2026-07-29T05:59:59Z" },
      limits: [
        {
          kind: "weekly_scoped",
          percent: 60,
          resets_at: "2026-07-26T05:59:59Z",
          scope: { model: { display_name: "Fable" } },
        },
      ],
    });

    expect(result.headlineWindowId).toBe("session");
    expect(
      result.windows.map(({ id, label, remainingPercent }) => [id, label, remainingPercent]),
    ).toEqual([
      ["session", "Session", 75],
      ["weekly", "Weekly", 60],
      ["routines", "Daily Routines", 100],
      ["weekly-fable", "Fable only", 40],
    ]);
  });

  it("uses weekly as the headline when session is absent", () => {
    const result = parseClaudeOAuthUsage({
      five_hour: null,
      seven_day: { utilization: 12, resets_at: "2026-07-26T05:59:59Z" },
    });

    expect(result.headlineWindowId).toBe("weekly");
    expect(result.windows.map((window) => window.id)).toEqual(["weekly"]);
  });
});
