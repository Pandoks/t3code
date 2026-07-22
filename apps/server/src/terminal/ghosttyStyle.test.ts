import { describe, expect, it } from "vite-plus/test";

import {
  ghosttyThemeSearchPaths,
  parseGhosttyConfig,
  splitThemeSelection,
} from "./ghosttyStyle.ts";

const posixPath = {
  isAbsolute: (value: string) => value.startsWith("/"),
  join: (...segments: ReadonlyArray<string>) =>
    segments
      .map((segment, index) =>
        index === 0 ? segment.replace(/\/$/, "") : segment.replace(/^\//, ""),
      )
      .join("/"),
};

const windowsPath = {
  isAbsolute: (value: string) => /^[A-Za-z]:[\\/]/.test(value),
  join: (...segments: ReadonlyArray<string>) => segments.join("\\"),
};

describe("parseGhosttyConfig", () => {
  it("resets scalar and palette colors with empty assignments", () => {
    const config = parseGhosttyConfig(`
      background = #000000
      foreground = #ffffff
      palette = 0=#111111
      palette = 1=#222222
      background =
      foreground = ""
      palette = 0=
      cursor-color = #c0ffee
    `);

    expect(config.colors.background).toBeUndefined();
    expect(config.colors.foreground).toBeUndefined();
    expect(config.colors.cursor).toBe("#c0ffee");
    expect(config.colors.palette[0]).toBe("");
    expect(config.colors.palette[1]).toBe("#222222");
  });
});

describe("parseGhosttyConfig bare hex colors", () => {
  it("normalizes hex colors written without a leading #", () => {
    const config = parseGhosttyConfig(`
      background = 020004
      foreground = EDF1F7
      cursor-color = c0ffee
      palette = 1=ff00ff
    `);

    expect(config.colors.background).toBe("#020004");
    expect(config.colors.foreground).toBe("#EDF1F7");
    expect(config.colors.cursor).toBe("#c0ffee");
    expect(config.colors.palette[1]).toBe("#ff00ff");
  });

  it("keeps named colors and #-prefixed values unchanged", () => {
    const config = parseGhosttyConfig(`
      background = #000000
      foreground = white
    `);

    expect(config.colors.background).toBe("#000000");
    expect(config.colors.foreground).toBe("white");
  });
});

describe("parseGhosttyConfig cursor settings", () => {
  it("parses cursor-style and cursor-style-blink", () => {
    const config = parseGhosttyConfig(`
      cursor-style = block
      cursor-style-blink = false
    `);

    expect(config.cursorStyle).toBe("block");
    expect(config.cursorBlink).toBe(false);
  });

  it("maps block_hollow to block and ignores unknown styles", () => {
    expect(parseGhosttyConfig("cursor-style = block_hollow").cursorStyle).toBe("block");
    expect(parseGhosttyConfig("cursor-style = wobble").cursorStyle).toBeUndefined();
    expect(parseGhosttyConfig("cursor-style = bar").cursorStyle).toBe("bar");
    expect(parseGhosttyConfig("cursor-style = underline").cursorStyle).toBe("underline");
  });

  it("leaves cursor settings undefined when absent", () => {
    const config = parseGhosttyConfig("font-size = 12");

    expect(config.cursorStyle).toBeUndefined();
    expect(config.cursorBlink).toBeUndefined();
  });
});

describe("splitThemeSelection", () => {
  it("keeps a Windows absolute theme path as a bare selection", () => {
    expect(splitThemeSelection("C:/Users/Alex/Ghostty Themes/t3code")).toEqual({
      light: "C:/Users/Alex/Ghostty Themes/t3code",
      dark: "C:/Users/Alex/Ghostty Themes/t3code",
    });
  });

  it("still parses explicit light and dark theme selections", () => {
    expect(splitThemeSelection("light:Day,dark:Night")).toEqual({
      light: "Day",
      dark: "Night",
    });
  });
});

describe("ghosttyThemeSearchPaths", () => {
  it("searches beside the macOS Application Support config", () => {
    const candidates = ghosttyThemeSearchPaths(posixPath, {
      home: "/Users/alex",
      xdgConfigHome: "/Users/alex/.config",
      themeName: "t3code",
    });

    expect(candidates).toContain(
      "/Users/alex/Library/Application Support/com.mitchellh.ghostty/themes/t3code",
    );
  });

  it("tries an absolute theme file before named-theme directories", () => {
    const candidates = ghosttyThemeSearchPaths(windowsPath, {
      home: "C:\\Users\\alex",
      xdgConfigHome: "C:\\Users\\alex\\.config",
      themeName: "D:\\themes\\t3code",
    });

    expect(candidates[0]).toBe("D:\\themes\\t3code");
  });
});
