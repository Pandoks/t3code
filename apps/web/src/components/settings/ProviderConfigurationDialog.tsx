"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  EnvironmentId,
  ProjectId,
  ProviderConfigurationResource,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { providerConfigurationEnvironment } from "../../state/providerConfiguration";
import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { openProjectDirectory } from "../../openProjectDirectoryBus";

type Tab = "overview" | "skills" | "instructions" | "mcp" | "settings";

export function renderConfigurationResource(input: {
  readonly kind: string;
  readonly value: unknown;
}): string {
  if (typeof input.value === "string") return input.value;
  return JSON.stringify(input.value, null, 2);
}

export function parseConfigurationDraft(
  provider: string,
  resourceId: string,
  draft: string,
): unknown {
  return provider === "claudeAgent" && resourceId === "settings" ? JSON.parse(draft) : draft;
}

interface ProviderConfigurationDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ProviderDriverKind;
}

export function ProviderConfigurationDialog(props: ProviderConfigurationDialogProps) {
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const [tab, setTab] = useState<Tab>("overview");
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftRevisionKey, setDraftRevisionKey] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [skillPackage, setSkillPackage] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [isRunningSkillAction, setIsRunningSkillAction] = useState(false);
  const target = useMemo(
    () => ({
      instanceId: props.instanceId,
      scope:
        projectId === null
          ? ({ type: "user" } as const)
          : ({ type: "project", projectId } as const),
    }),
    [projectId, props.instanceId],
  );
  const query = useEnvironmentQuery(
    props.open
      ? providerConfigurationEnvironment.snapshot({
          environmentId: props.environmentId,
          input: target,
        })
      : null,
  );
  const validate = useAtomCommand(providerConfigurationEnvironment.validate, {
    label: "Validate provider configuration",
  });
  const apply = useAtomCommand(providerConfigurationEnvironment.apply, {
    label: "Apply provider configuration",
  });
  const runSkillAction = useAtomCommand(providerConfigurationEnvironment.runSkillAction, {
    label: "Manage provider skills",
  });

  const revisionKey =
    query.data?.resources.map((resource) => `${resource.id}:${resource.revision}`).join("|") ?? "";
  useEffect(() => {
    if (!query.data || revisionKey === draftRevisionKey) return;
    setDrafts(
      Object.fromEntries(
        query.data.resources.map((resource) => [
          resource.id,
          renderConfigurationResource(resource),
        ]),
      ),
    );
    setDraftRevisionKey(revisionKey);
    setDraftError(null);
  }, [draftRevisionKey, query.data, revisionKey]);

  const changedResources = (query.data?.resources ?? []).filter(
    (resource) => drafts[resource.id] !== renderConfigurationResource(resource),
  );

  const makeChanges = () =>
    changedResources.map((resource) => ({
      resourceId: resource.id,
      expectedRevision: resource.revision,
      operation: "write" as const,
      value: parseConfigurationDraft(
        String(props.provider),
        resource.id,
        drafts[resource.id] ?? "",
      ),
    }));

  const handleApply = async () => {
    setDraftError(null);
    let changes;
    try {
      changes = makeChanges();
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Invalid configuration value.");
      return;
    }
    setIsApplying(true);
    const validation = await validate({
      environmentId: props.environmentId,
      input: { target, changes },
    });
    if (validation._tag === "Failure" || !validation.value.valid) {
      setDraftError(
        validation._tag === "Success"
          ? validation.value.issues.map((issue) => issue.message).join(" ")
          : "Configuration validation failed.",
      );
      setIsApplying(false);
      return;
    }
    const result = await apply({
      environmentId: props.environmentId,
      input: { target, changes },
    });
    setIsApplying(false);
    if (result._tag === "Failure") {
      setDraftError("Configuration changed or could not be written. Reload and try again.");
      return;
    }
    toastManager.add({
      type: "success",
      title: "Provider configuration updated",
      description: result.value.restartRequired
        ? "Changes apply to new provider sessions."
        : "Changes were applied.",
    });
    query.refresh();
  };

  const runSkill = async (action: "install" | "update" | "remove", skill?: string) => {
    setIsRunningSkillAction(true);
    const agents = [props.provider === "claudeAgent" ? "claude-code" : "codex"];
    const actionInput =
      action === "install"
        ? { type: "install" as const, package: skillPackage.trim(), skills: ["*"], agents }
        : action === "update"
          ? { type: "update" as const, skills: skill ? [skill] : [] }
          : { type: "remove" as const, skills: skill ? [skill] : [], agents };
    const result = await runSkillAction({
      environmentId: props.environmentId,
      input: { target, action: actionInput },
    });
    setIsRunningSkillAction(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Skill action failed" });
      return;
    }
    setSkillPackage("");
    query.refresh();
  };

  const editableResource = (
    id: "settings" | "instructions",
  ): ProviderConfigurationResource | undefined =>
    query.data?.resources.find((resource) => resource.id === id);

  const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "skills", label: "Skills" },
    { id: "instructions", label: "Instructions" },
    { id: "mcp", label: "MCP" },
    { id: "settings", label: "Settings" },
  ];

  const renderEditor = (resource: ProviderConfigurationResource | undefined) =>
    resource ? (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{resource.displayName}</span>
          <code>{resource.nativePathLabel}</code>
        </div>
        <Textarea
          className="min-h-72 font-mono text-xs"
          value={drafts[resource.id] ?? ""}
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [resource.id]: event.target.value }))
          }
          spellCheck={false}
        />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">This resource is unavailable.</p>
    );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Manage {String(props.provider)} configuration</DialogTitle>
          <DialogDescription>
            Provider-native files remain the source of truth. Changes are validated before writing.
          </DialogDescription>
          <div className="pt-2">
            <Select
              value={projectId ?? "user"}
              onValueChange={(value) => {
                setProjectId(value === "user" ? null : (value as ProjectId));
                setDraftRevisionKey("");
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="user">User configuration</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    Project: {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </DialogHeader>

        <div className="border-y border-border/70">
          <div className="flex gap-1 border-b border-border/70 px-5 py-2">
            {tabs.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={tab === item.id ? "secondary" : "ghost"}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="max-h-[65vh] min-h-80 overflow-y-auto p-5">
            {query.isPending ? (
              <p className="text-sm text-muted-foreground">Loading configuration…</p>
            ) : null}
            {query.error ? <p className="text-sm text-destructive">{query.error}</p> : null}
            {tab === "overview" && query.data ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">Scope</p>
                  <p className="text-xs text-muted-foreground">{projectId ? "Project" : "User"}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">Installed skills</p>
                  <p className="text-xs text-muted-foreground">{query.data.skills.skills.length}</p>
                </div>
                {query.data.issues.map((issue) => (
                  <p
                    key={`${issue.resourceId ?? "general"}:${issue.severity}:${issue.message}`}
                    className="text-sm text-destructive"
                  >
                    {issue.message}
                  </p>
                ))}
              </div>
            ) : null}
            {tab === "instructions" ? renderEditor(editableResource("instructions")) : null}
            {tab === "settings" ? renderEditor(editableResource("settings")) : null}
            {tab === "mcp" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  MCP servers are stored in this provider’s native settings. Edit the advanced
                  native settings below.
                </p>
                {renderEditor(editableResource("settings"))}
              </div>
            ) : null}
            {tab === "skills" && query.data ? (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={skillPackage}
                    onChange={(event) => setSkillPackage(event.target.value)}
                    placeholder="owner/repository or Git URL"
                  />
                  <Button
                    disabled={!skillPackage.trim() || isRunningSkillAction}
                    onClick={() => void runSkill("install")}
                  >
                    Install
                  </Button>
                </div>
                {!query.data.skills.available ? (
                  <p className="text-sm text-muted-foreground">
                    The skills CLI is unavailable on this environment.
                  </p>
                ) : null}
                {query.data.skills.skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{skill.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {skill.scope} · {skill.directory}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          props.onOpenChange(false);
                          openProjectDirectory({
                            environmentId: props.environmentId,
                            directory: skill.directory,
                          });
                        }}
                      >
                        Open project
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRunningSkillAction}
                        onClick={() => void runSkill("update", skill.name)}
                      >
                        Update
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isRunningSkillAction}
                        onClick={() => void runSkill("remove", skill.name)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          {draftError ? <p className="mr-auto text-xs text-destructive">{draftError}</p> : null}
          <Button variant="outline" onClick={query.refresh}>
            Reload
          </Button>
          <Button
            disabled={changedResources.length === 0 || isApplying}
            onClick={() => void handleApply()}
          >
            {isApplying
              ? "Applying…"
              : `Review & Apply${changedResources.length ? ` (${changedResources.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
