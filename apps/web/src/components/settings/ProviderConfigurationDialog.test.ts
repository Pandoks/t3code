import { describe, expect, it } from "vite-plus/test";

import {
  parseConfigurationDraft,
  renderConfigurationResource,
} from "./ProviderConfigurationDialog.tsx";

describe("ProviderConfigurationDialog resource editing", () => {
  it("renders text resources directly and JSON settings with stable indentation", () => {
    expect(renderConfigurationResource({ kind: "instructions", value: "Use tests.\n" })).toBe(
      "Use tests.\n",
    );
    expect(renderConfigurationResource({ kind: "settings", value: { model: "opus" } })).toBe(
      '{\n  "model": "opus"\n}',
    );
  });

  it("parses Claude JSON settings and keeps Codex TOML as native text", () => {
    expect(parseConfigurationDraft("claudeAgent", "settings", '{"model":"opus"}')).toEqual({
      model: "opus",
    });
    expect(parseConfigurationDraft("codex", "settings", 'model = "gpt-5"')).toBe('model = "gpt-5"');
  });
});
