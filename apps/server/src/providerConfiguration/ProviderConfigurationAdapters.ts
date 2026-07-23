import type { ProviderConfigurationIssue, ProviderConfigurationResource } from "@t3tools/contracts";

import { readConfigurationFile } from "./ProviderConfigurationFileStore.ts";

type AdapterScope = "user" | "project";

export interface ProviderConfigurationAdapterSnapshot {
  readonly resources: ReadonlyArray<ProviderConfigurationResource>;
  readonly issues: ReadonlyArray<ProviderConfigurationIssue>;
}

interface ResourceDefinition {
  readonly id: string;
  readonly kind: "settings" | "instructions";
  readonly displayName: string;
  readonly relativePath: string;
  readonly parse: (contents: string) => unknown;
}

const text = (contents: string): unknown => contents;
const json = (contents: string): unknown => (contents.trim() === "" ? {} : JSON.parse(contents));

async function readResources(
  root: string,
  definitions: ReadonlyArray<ResourceDefinition>,
): Promise<ProviderConfigurationAdapterSnapshot> {
  const resources: ProviderConfigurationResource[] = [];
  const issues: ProviderConfigurationIssue[] = [];

  for (const definition of definitions) {
    const snapshot = await readConfigurationFile(root, definition.relativePath);
    let value: unknown = definition.kind === "instructions" ? "" : {};
    try {
      value = definition.parse(snapshot.contents);
    } catch {
      value = snapshot.contents;
      issues.push({
        severity: "error",
        resourceId: definition.id,
        message: `${definition.displayName} is not valid JSON. Fix it before applying changes.`,
      });
    }
    resources.push({
      id: definition.id,
      kind: definition.kind,
      displayName: definition.displayName,
      nativePathLabel: definition.relativePath,
      revision: snapshot.revision,
      exists: snapshot.exists,
      writable: true,
      value,
    });
  }

  return { resources, issues };
}

export function readCodexConfiguration(input: {
  readonly root: string;
  readonly scope: AdapterScope;
}): Promise<ProviderConfigurationAdapterSnapshot> {
  return readResources(input.root, [
    {
      id: "settings",
      kind: "settings",
      displayName: "Codex settings",
      relativePath: input.scope === "user" ? "config.toml" : ".codex/config.toml",
      parse: text,
    },
    {
      id: "instructions",
      kind: "instructions",
      displayName: "Codex instructions",
      relativePath: "AGENTS.md",
      parse: text,
    },
  ]);
}

export function readClaudeConfiguration(input: {
  readonly root: string;
  readonly scope: AdapterScope;
}): Promise<ProviderConfigurationAdapterSnapshot> {
  return readResources(input.root, [
    {
      id: "settings",
      kind: "settings",
      displayName: "Claude settings",
      relativePath: input.scope === "user" ? "settings.json" : ".claude/settings.json",
      parse: json,
    },
    {
      id: "instructions",
      kind: "instructions",
      displayName: "Claude instructions",
      relativePath: input.scope === "user" ? "CLAUDE.md" : "CLAUDE.md",
      parse: text,
    },
  ]);
}

export function serializeProviderResource(input: {
  readonly provider: "codex" | "claudeAgent";
  readonly resourceId: string;
  readonly value: unknown;
}): string {
  if (input.resourceId === "instructions" || input.provider === "codex") {
    if (typeof input.value !== "string") throw new Error("Expected text configuration value.");
    return input.value;
  }
  return `${JSON.stringify(input.value, null, 2)}\n`;
}
