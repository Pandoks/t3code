export function validateNewSkillInput(input: {
  parentDirectory: string;
  name: string;
  agents: ReadonlyArray<string>;
}): string | null {
  if (!input.parentDirectory.trim()) return "Choose a parent directory.";
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/u.test(input.name.trim())) {
    return "Use a name that starts with a letter and contains only letters, numbers, - or _.";
  }
  if (input.agents.length === 0) return "Choose at least one target agent.";
  return null;
}

export function buildSkillDevelopmentPrompt(name: string): string {
  return `Help me develop the ${name} skill in this directory. Inspect SKILL.md and the local files, implement the skill, then validate it with the available skill validation tooling.`;
}
