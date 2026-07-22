"use client";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { findProjectByPath, inferProjectTitleFromPath } from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import { onOpenNewSkillDialog } from "../newSkillDialogBus";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import { projectEnvironment } from "../state/projects";
import { providerConfigurationEnvironment } from "../state/providerConfiguration";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { buildSkillDevelopmentPrompt, validateNewSkillInput } from "./NewSkillDialog.logic";

const AGENT_OPTIONS = [
  { id: "codex", label: "Codex", driver: "codex" },
  { id: "claude-code", label: "Claude Code", driver: "claudeAgent" },
] as const;

export function NewSkillDialog() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const initializeSkill = useAtomCommand(providerConfigurationEnvironment.initializeSkill, {
    reportFailure: false,
  });
  const linkLocalSkill = useAtomCommand(providerConfigurationEnvironment.runSkillAction, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();
  const [open, setOpen] = useState(false);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const [parentDirectory, setParentDirectory] = useState("");
  const [name, setName] = useState("");
  const [agents, setAgents] = useState<Array<"codex" | "claude-code">>(["codex", "claude-code"]);
  const [installMode, setInstallMode] = useState<"copy" | "symlink">("symlink");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => onOpenNewSkillDialog(() => setOpen(true)), []);
  useEffect(() => {
    if (environmentId === null && primaryEnvironmentId) setEnvironmentId(primaryEnvironmentId);
  }, [environmentId, primaryEnvironmentId]);
  const environment = useMemo(
    () => environments.find((item) => item.environmentId === environmentId) ?? null,
    [environmentId, environments],
  );

  const submit = async () => {
    if (!environmentId) return;
    const validation = validateNewSkillInput({ parentDirectory, name, agents });
    if (validation) return setError(validation);
    setPending(true);
    setError(null);
    const driver = AGENT_OPTIONS.find((option) => option.id === agents[0])
      ?.driver as ProviderDriverKind;
    const initialized = await initializeSkill({
      environmentId,
      input: {
        instanceId: defaultInstanceIdForDriver(driver),
        parentDirectory: parentDirectory.trim(),
        name: name.trim(),
        agents,
        installMode,
      },
    });
    if (initialized._tag === "Failure") {
      setPending(false);
      setError(
        "The skill directory could not be initialized. Check the parent path and Skills CLI.",
      );
      return;
    }

    const directory = initialized.value.directory;
    const existing = findProjectByPath(
      projects.filter((item) => item.environmentId === environmentId),
      directory,
    );
    let projectId = existing?.id;
    if (!projectId) {
      projectId = newProjectId();
      const created = await createProject({
        environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(directory),
          workspaceRoot: directory,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: resolveDefaultProviderModelSelection(
            environment?.serverConfig?.providers ?? [],
            null,
          ),
        },
      });
      if (created._tag === "Failure") {
        setPending(false);
        const failure = squashAtomCommandFailure(created);
        setError(
          failure instanceof Error ? failure.message : "The skill project could not be added.",
        );
        return;
      }
    }
    for (const agent of agents) {
      const agentDriver = AGENT_OPTIONS.find((option) => option.id === agent)
        ?.driver as ProviderDriverKind;
      const linked = await linkLocalSkill({
        environmentId,
        input: {
          target: {
            instanceId: defaultInstanceIdForDriver(agentDriver),
            scope: { type: "user" },
          },
          action: { type: "linkLocal", directory, agents: [agent], installMode },
        },
      });
      if (linked._tag === "Failure") {
        setPending(false);
        const failure = squashAtomCommandFailure(linked);
        setError(
          failure instanceof Error
            ? `The directory was created and added as a project, but provider installation failed: ${failure.message}`
            : "The directory was created and added as a project, but provider installation failed.",
        );
        return;
      }
    }
    setOpen(false);
    await handleNewThread(scopeProjectRef(environmentId, projectId), {
      initialPrompt: buildSkillDevelopmentPrompt(name.trim()),
    });
    setPending(false);
    setName("");
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Skill project created",
        description: `${directory} is ready in the sidebar.`,
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Skill</DialogTitle>
          <DialogDescription>
            Initialize a local skill directory, add it as a project, and start a skill-development
            chat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-2">
          <div className="space-y-2">
            <Label>Environment</Label>
            <Select
              value={environmentId ?? ""}
              onValueChange={(value) => setEnvironmentId(value as EnvironmentId)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose an environment" />
              </SelectTrigger>
              <SelectPopup>
                {environments.map((item) => (
                  <SelectItem key={item.environmentId} value={item.environmentId}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-skill-parent">Parent directory</Label>
            <Input
              id="new-skill-parent"
              value={parentDirectory}
              onChange={(event) => setParentDirectory(event.target.value)}
              placeholder="/Users/me/Projects/skills"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-skill-name">Skill name</Label>
            <Input
              id="new-skill-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-skill"
            />
          </div>
          <div className="space-y-2">
            <Label>Target agents</Label>
            <div className="flex gap-2">
              {AGENT_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  size="sm"
                  variant={agents.includes(option.id) ? "secondary" : "outline"}
                  onClick={() =>
                    setAgents((current) =>
                      current.includes(option.id)
                        ? current.filter((agent) => agent !== option.id)
                        : [...current, option.id],
                    )
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Install mode</Label>
            <Select
              value={installMode}
              onValueChange={(value) => setInstallMode(value as "copy" | "symlink")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="symlink">Symlink (recommended)</SelectItem>
                <SelectItem value="copy">Copy</SelectItem>
              </SelectPopup>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !environmentId} onClick={() => void submit()}>
            {pending ? "Creating…" : "Create Skill"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
