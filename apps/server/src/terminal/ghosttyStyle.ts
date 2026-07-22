import * as NodeOS from "node:os";

import type { ServerTerminalStyle, ServerTerminalThemeColors } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const PALETTE_SIZE = 16;

type GhosttyCursorStyle = "block" | "bar" | "underline";

interface GhosttyConfigValues {
  readonly fontFamily: ReadonlyArray<string>;
  readonly fontSize: number | undefined;
  readonly theme: string | undefined;
  readonly cursorStyle: GhosttyCursorStyle | undefined;
  readonly cursorBlink: boolean | undefined;
  readonly colors: MutableThemeColors;
}

// Ghostty's block_hollow has no ghostty-web equivalent; render it as block.
function parseCursorStyle(value: string): GhosttyCursorStyle | undefined {
  switch (value) {
    case "block":
    case "block_hollow":
      return "block";
    case "bar":
      return "bar";
    case "underline":
      return "underline";
    default:
      return undefined;
  }
}

function parseBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

interface MutableThemeColors {
  background?: string | undefined;
  foreground?: string | undefined;
  cursor?: string | undefined;
  selectionBackground?: string | undefined;
  selectionForeground?: string | undefined;
  palette: Array<string>;
}

function emptyColors(): MutableThemeColors {
  return { palette: Array.from({ length: PALETTE_SIZE }, () => "") };
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

// Ghostty accepts hex colors with or without the leading #; CSS does not.
function normalizeColorValue(value: string): string {
  return /^[0-9a-fA-F]{6}$/.test(value) ? `#${value}` : value;
}

function applyColorEntry(colors: MutableThemeColors, key: string, rawValue: string): void {
  const value = normalizeColorValue(rawValue);
  switch (key) {
    case "background":
      if (value.length === 0) delete colors.background;
      else colors.background = value;
      return;
    case "foreground":
      if (value.length === 0) delete colors.foreground;
      else colors.foreground = value;
      return;
    case "cursor-color":
      if (value.length === 0) delete colors.cursor;
      else colors.cursor = value;
      return;
    case "selection-background":
      if (value.length === 0) delete colors.selectionBackground;
      else colors.selectionBackground = value;
      return;
    case "selection-foreground":
      if (value.length === 0) delete colors.selectionForeground;
      else colors.selectionForeground = value;
      return;
    case "palette": {
      const match = value.match(/^(\d+)\s*=\s*(\S*)$/);
      if (!match) return;
      const index = Number(match[1]);
      if (!Number.isInteger(index) || index < 0 || index >= PALETTE_SIZE) return;
      colors.palette[index] = normalizeColorValue(match[2] ?? "");
      return;
    }
    default:
      return;
  }
}

/** Parse Ghostty's `key = value` config format, keeping only what the web terminal uses. */
export function parseGhosttyConfig(source: string): GhosttyConfigValues {
  const fontFamily: Array<string> = [];
  let fontSize: number | undefined;
  let theme: string | undefined;
  let cursorStyle: GhosttyCursorStyle | undefined;
  let cursorBlink: boolean | undefined;
  const colors = emptyColors();

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = stripQuotes(line.slice(separatorIndex + 1).trim());

    switch (key) {
      case "font-family":
        // Repeated entries build a fallback chain; an empty value resets it.
        if (value.length === 0) {
          fontFamily.length = 0;
        } else {
          fontFamily.push(value);
        }
        break;
      case "font-size": {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          fontSize = parsed;
        }
        break;
      }
      case "theme":
        theme = value.length > 0 ? value : undefined;
        break;
      case "cursor-style":
        cursorStyle = parseCursorStyle(value);
        break;
      case "cursor-style-blink":
        cursorBlink = parseBoolean(value);
        break;
      default:
        applyColorEntry(colors, key, value);
        break;
    }
  }

  return { fontFamily, fontSize, theme, cursorStyle, cursorBlink, colors };
}

/** Split `theme = light:A,dark:B` into per-mode names; a bare name applies to both. */
export function splitThemeSelection(theme: string): { light?: string; dark?: string } {
  const result: { light?: string; dark?: string } = {};
  let hasModeSelection = false;
  for (const part of theme.split(",")) {
    const match = /^\s*(light|dark):(.*)$/.exec(part);
    if (!match) continue;
    const mode = match[1];
    const name = (match[2] ?? "").trim();
    if (name.length === 0) continue;
    hasModeSelection = true;
    if (mode === "light") result.light = name;
    if (mode === "dark") result.dark = name;
  }
  // A colon is also part of a Windows drive path (C:/theme), and may be part
  // of another valid bare theme identifier. Only enter per-mode parsing when
  // an explicit light: or dark: selection was recognized.
  return hasModeSelection ? result : { light: theme, dark: theme };
}

function hasAnyColor(colors: MutableThemeColors): boolean {
  return (
    colors.background !== undefined ||
    colors.foreground !== undefined ||
    colors.cursor !== undefined ||
    colors.selectionBackground !== undefined ||
    colors.selectionForeground !== undefined ||
    colors.palette.some((entry) => entry.length > 0)
  );
}

function mergeColors(base: MutableThemeColors, override: MutableThemeColors): MutableThemeColors {
  return {
    background: override.background ?? base.background,
    foreground: override.foreground ?? base.foreground,
    cursor: override.cursor ?? base.cursor,
    selectionBackground: override.selectionBackground ?? base.selectionBackground,
    selectionForeground: override.selectionForeground ?? base.selectionForeground,
    palette: base.palette.map((entry, index) => {
      const overrideEntry = override.palette[index] ?? "";
      return overrideEntry.length > 0 ? overrideEntry : entry;
    }),
  };
}

function toThemeColors(colors: MutableThemeColors): ServerTerminalThemeColors | undefined {
  if (!hasAnyColor(colors)) return undefined;
  return {
    ...(colors.background !== undefined ? { background: colors.background } : {}),
    ...(colors.foreground !== undefined ? { foreground: colors.foreground } : {}),
    ...(colors.cursor !== undefined ? { cursor: colors.cursor } : {}),
    ...(colors.selectionBackground !== undefined
      ? { selectionBackground: colors.selectionBackground }
      : {}),
    ...(colors.selectionForeground !== undefined
      ? { selectionForeground: colors.selectionForeground }
      : {}),
    palette: colors.palette,
  };
}

// Bundled theme locations by platform: the macOS app bundle and the
// Linux system resource dirs documented by Ghostty.
const GHOSTTY_SYSTEM_THEME_DIRS = [
  "/Applications/Ghostty.app/Contents/Resources/ghostty/themes",
  "/usr/share/ghostty/themes",
  "/usr/local/share/ghostty/themes",
];

export function ghosttyThemeSearchPaths(
  path: Pick<Path.Path, "isAbsolute" | "join">,
  input: { readonly home: string; readonly xdgConfigHome: string; readonly themeName: string },
): ReadonlyArray<string> {
  return [
    ...(path.isAbsolute(input.themeName) ? [input.themeName] : []),
    path.join(input.xdgConfigHome, "ghostty", "themes", input.themeName),
    path.join(
      input.home,
      "Library",
      "Application Support",
      "com.mitchellh.ghostty",
      "themes",
      input.themeName,
    ),
    ...GHOSTTY_SYSTEM_THEME_DIRS.map((dir) => path.join(dir, input.themeName)),
  ];
}

/**
 * Load terminal font and theme colors from the user's local Ghostty config.
 * Best effort by design: any missing file or parse problem yields `undefined`
 * so the client falls back to its built-in terminal appearance.
 */
export const loadGhosttyTerminalStyle: Effect.Effect<
  ServerTerminalStyle | undefined,
  never,
  FileSystem.FileSystem | Path.Path
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = NodeOS.homedir();
  // Per the XDG spec an empty XDG_CONFIG_HOME must be treated as unset.
  const xdgConfigHomeEnv = process.env["XDG_CONFIG_HOME"];
  const xdgConfigHome =
    xdgConfigHomeEnv !== undefined && xdgConfigHomeEnv.length > 0
      ? xdgConfigHomeEnv
      : path.join(home, ".config");

  const readFirstExisting = (candidates: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      for (const candidate of candidates) {
        const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
        if (!exists) continue;
        const content = yield* fs
          .readFileString(candidate)
          .pipe(Effect.orElseSucceed(() => undefined));
        if (content !== undefined) return content;
      }
      return undefined;
    });

  // Ghostty reads the XDG config first and the macOS Application Support
  // config after it, so later files override earlier values. It also accepts
  // config.ghostty as the file name. Merge every location that exists instead
  // of stopping at the first match.
  const configDirs = [
    path.join(xdgConfigHome, "ghostty"),
    path.join(home, "Library", "Application Support", "com.mitchellh.ghostty"),
  ];
  const configSources: Array<string> = [];
  for (const dir of configDirs) {
    // Read both file names when they coexist so neither shadows the other;
    // Ghostty loads config.ghostty before config, so config wins conflicts.
    for (const candidate of [path.join(dir, "config.ghostty"), path.join(dir, "config")]) {
      const source = yield* readFirstExisting([candidate]);
      if (source !== undefined) configSources.push(source);
    }
  }
  if (configSources.length === 0) return undefined;

  const config = parseGhosttyConfig(configSources.join("\n"));

  const loadThemeColors = (themeName: string) =>
    Effect.gen(function* () {
      const themeSource = yield* readFirstExisting(
        ghosttyThemeSearchPaths(path, { home, xdgConfigHome, themeName }),
      );
      if (themeSource === undefined) return emptyColors();
      return parseGhosttyConfig(themeSource).colors;
    });

  const themeSelection = config.theme ? splitThemeSelection(config.theme) : {};
  const resolveModeColors = (themeName: string | undefined) =>
    Effect.gen(function* () {
      const themeColors = themeName ? yield* loadThemeColors(themeName) : emptyColors();
      // Explicit colors in the user config override the selected theme.
      return toThemeColors(mergeColors(themeColors, config.colors));
    });

  const light = yield* resolveModeColors(themeSelection.light);
  const dark = yield* resolveModeColors(themeSelection.dark);

  const style: ServerTerminalStyle = {
    ...(config.fontFamily.length > 0 ? { fontFamily: config.fontFamily } : {}),
    ...(config.fontSize !== undefined ? { fontSize: config.fontSize } : {}),
    ...(config.cursorStyle !== undefined ? { cursorStyle: config.cursorStyle } : {}),
    ...(config.cursorBlink !== undefined ? { cursorBlink: config.cursorBlink } : {}),
    ...(light !== undefined ? { light } : {}),
    ...(dark !== undefined ? { dark } : {}),
  };

  const hasAnyValue =
    style.fontFamily !== undefined ||
    style.fontSize !== undefined ||
    style.cursorStyle !== undefined ||
    style.cursorBlink !== undefined ||
    style.light !== undefined ||
    style.dark !== undefined;
  return hasAnyValue ? style : undefined;
}).pipe(Effect.orElseSucceed(() => undefined));
