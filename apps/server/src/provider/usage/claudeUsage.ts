import * as DateTime from "effect/DateTime";

import type { ProviderUsageSnapshotDraft, ProviderUsageWindow } from "./ProviderUsage.ts";
import { normalizeUsageWindow } from "./normalize.ts";

const MONTHS = new Map([
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["may", 5],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
]);

function parseClock(value: string): { readonly hours: number; readonly minutes: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (match[3]?.toLowerCase() === "pm" && hours !== 12) hours += 12;
  if (match[3]?.toLowerCase() === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

function parseReset(value: string, now: DateTime.DateTime): string | null {
  const zoneMatch = /\(([^)]+)\)\s*$/.exec(value);
  const zone = zoneMatch?.[1] ?? "UTC";
  const body = value.replace(/\s*\([^)]+\)\s*$/, "").trim();
  let zonedNow: DateTime.Zoned;
  try {
    zonedNow = DateTime.setZoneNamedUnsafe(now, zone);
  } catch {
    return null;
  }
  const nowParts = DateTime.toParts(zonedNow);
  const dated = /^([A-Za-z]+)\s+(\d{1,2})\s+at\s+(.+)$/.exec(body);
  const clock = parseClock(dated?.[3] ?? body);
  if (!clock) return null;
  const month = dated ? MONTHS.get(dated[1]!.slice(0, 3).toLowerCase()) : nowParts.month;
  if (!month) return null;

  let target = DateTime.makeZonedUnsafe(
    {
      year: nowParts.year,
      month,
      day: dated ? Number(dated[2]) : nowParts.day,
      hour: clock.hours,
      minute: clock.minutes,
      second: 0,
      millisecond: 0,
    },
    { timeZone: zone, adjustForTimeZone: true },
  );
  if (DateTime.toEpochMillis(target) <= DateTime.toEpochMillis(zonedNow)) {
    target = DateTime.add(target, dated ? { years: 1 } : { days: 1 });
  }
  return DateTime.formatIso(DateTime.toUtc(target));
}

function parseWindow(
  lines: ReadonlyArray<string>,
  definition: {
    readonly id: string;
    readonly label: string;
    readonly windowDurationMinutes: number;
  },
  now: DateTime.DateTime,
): ProviderUsageWindow | null {
  const index = lines.findIndex((line) => line.trim() === definition.label);
  if (index < 0) return null;
  const following = lines.slice(index + 1, index + 6).join("\n");
  const used = /(\d+(?:\.\d+)?)%\s+used/i.exec(following);
  const reset = /Resets\s+([^\n]+)/i.exec(following);
  const resetsAt = reset?.[1] ? parseReset(reset[1].trim(), now) : null;
  if (!used || !resetsAt) return null;
  return normalizeUsageWindow({
    ...definition,
    usedPercent: Number(used[1]),
    resetsAtEpochSeconds: DateTime.toEpochMillis(DateTime.makeUnsafe(resetsAt)) / 1_000,
  });
}

export function parseClaudeUsageScreen(
  screen: string,
  now: DateTime.DateTime = DateTime.nowUnsafe(),
): ProviderUsageSnapshotDraft {
  const lines = screen.split(/\r?\n/);
  const windows = [
    { id: "session", label: "Current session", windowDurationMinutes: 300 },
    { id: "week", label: "Current week (all models)", windowDurationMinutes: 10_080 },
    { id: "week-sonnet", label: "Current week (Sonnet only)", windowDurationMinutes: 10_080 },
    { id: "week-opus", label: "Current week (Opus only)", windowDurationMinutes: 10_080 },
    { id: "week-fable", label: "Current week (Fable only)", windowDurationMinutes: 10_080 },
  ].flatMap((definition) => {
    const window = parseWindow(lines, definition, now);
    return window ? [window] : [];
  });
  return {
    headlineWindowId:
      windows.find((window) => window.id === "session")?.id ?? windows[0]?.id ?? null,
    windows,
  };
}

export function renderAnsiTerminal(input: string, columns = 160, rows = 150): string {
  const screen = Array.from({ length: rows }, () => Array(columns).fill(" ") as string[]);
  let row = 0;
  let column = 0;
  let savedRow = 0;
  let savedColumn = 0;
  const clampCursor = () => {
    row = Math.max(0, Math.min(rows - 1, row));
    column = Math.max(0, Math.min(columns - 1, column));
  };

  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (character === "\u001b") {
      const next = input[index + 1];
      if (next === "]") {
        const bell = input.indexOf("\u0007", index + 2);
        const terminator = input.indexOf("\u001b\\", index + 2);
        const end = bell < 0 ? terminator : terminator < 0 ? bell : Math.min(bell, terminator);
        index = end < 0 ? input.length : end + (end === terminator ? 1 : 0);
        continue;
      }
      if (next === "7") {
        savedRow = row;
        savedColumn = column;
        index++;
        continue;
      }
      if (next === "8") {
        row = savedRow;
        column = savedColumn;
        index++;
        continue;
      }
      if (next !== "[") {
        index += next === "(" || next === ")" ? 2 : 1;
        continue;
      }
      const match = /^\[([?\d;>]*)([ -/]?)([@-~])/.exec(input.slice(index + 1));
      if (!match) continue;
      index += match[0].length;
      const values = match[1]!
        .replace(/^\?/, "")
        .split(";")
        .map((value) => Number(value || 0));
      const count = values[0] || 1;
      switch (match[3]) {
        case "A":
          row -= count;
          break;
        case "B":
          row += count;
          break;
        case "C":
          column += count;
          break;
        case "D":
          column -= count;
          break;
        case "G":
          column = count - 1;
          break;
        case "d":
          row = count - 1;
          break;
        case "H":
        case "f":
          row = (values[0] || 1) - 1;
          column = (values[1] || 1) - 1;
          break;
        case "J":
          if (values[0] === 2 || values[0] === 3) {
            for (const line of screen) line.fill(" ");
          }
          break;
        case "K":
          if (values[0] === 1) screen[row]!.fill(" ", 0, column + 1);
          else if (values[0] === 2) screen[row]!.fill(" ");
          else screen[row]!.fill(" ", column);
          break;
        case "s":
          savedRow = row;
          savedColumn = column;
          break;
        case "u":
          row = savedRow;
          column = savedColumn;
          break;
      }
      clampCursor();
      continue;
    }
    if (character === "\r") {
      column = 0;
    } else if (character === "\n") {
      row++;
      clampCursor();
    } else if (character === "\b") {
      column = Math.max(0, column - 1);
    } else if (character >= " ") {
      screen[row]![column] = character;
      column++;
      if (column >= columns) {
        column = 0;
        row++;
        clampCursor();
      }
    }
  }
  const lines = screen.map((line) => line.join("").trimEnd());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}
