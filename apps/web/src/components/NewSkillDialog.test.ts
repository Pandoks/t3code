import { describe, expect, it } from "vite-plus/test";

import { buildSkillDevelopmentPrompt, validateNewSkillInput } from "./NewSkillDialog.logic.ts";

describe("NewSkillDialog helpers", () => {
  it("validates directory, slug, and agent selection", () => {
    expect(
      validateNewSkillInput({ parentDirectory: "", name: "skill", agents: ["codex"] }),
    ).toBeTruthy();
    expect(
      validateNewSkillInput({ parentDirectory: "/tmp", name: "bad name", agents: ["codex"] }),
    ).toBeTruthy();
    expect(
      validateNewSkillInput({ parentDirectory: "/tmp", name: "skill", agents: [] }),
    ).toBeTruthy();
    expect(
      validateNewSkillInput({ parentDirectory: "/tmp", name: "skill_name", agents: ["codex"] }),
    ).toBeNull();
  });

  it("seeds a concrete skill-development task", () => {
    expect(buildSkillDevelopmentPrompt("release-notes")).toContain("release-notes");
    expect(buildSkillDevelopmentPrompt("release-notes")).toContain("SKILL.md");
    expect(buildSkillDevelopmentPrompt("release-notes")).toContain("validate");
  });
});
