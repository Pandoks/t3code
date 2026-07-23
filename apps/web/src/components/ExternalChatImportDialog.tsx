import type {
  EnvironmentId,
  ExternalChatCandidate,
  ExternalChatCandidateId,
  ExternalChatImportItemResult,
  ExternalChatSource,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useRouter } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  ImportIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useActiveEnvironmentId, useProjects } from "../state/entities";
import { externalChatEnvironment } from "../state/externalChats";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { cn } from "../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SidebarMenuButton } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { PROVIDER_ICON_BY_PROVIDER } from "./chat/providerIconUtils";
import {
  applyExternalChatImportResults,
  buildExternalChatImportBatches,
  failedExternalChatImportBatchResults,
  filterAndGroupExternalChats,
  getExternalChatCandidateState,
  reconcileExternalChatRefreshState,
  resolveInitialExternalChatEnvironmentId,
  resolveExternalChatImportNavigationTarget,
  resolveExternalChatProject,
  summarizeExternalChatImport,
  toggleExternalChatSelection,
  type ExternalChatImportProject,
} from "./ExternalChatImportDialog.logic";

const SOURCE_LABELS: Record<ExternalChatSource, string> = {
  codex: "Codex",
  claude: "Claude",
};

const SOURCE_DRIVER_KINDS: Record<ExternalChatSource, ProviderDriverKind> = {
  codex: ProviderDriverKind.make("codex"),
  claude: ProviderDriverKind.make("claudeAgent"),
};

const DEFAULT_PROVIDER_INSTANCE_IDS: Record<ExternalChatSource, string> = {
  codex: "codex",
  claude: "claudeAgent",
};

function humanizeProviderInstanceId(providerInstanceId: string): string {
  return providerInstanceId
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function externalChatProviderLabel(candidate: ExternalChatCandidate): string {
  if (candidate.providerDisplayName) return candidate.providerDisplayName;
  if (candidate.providerInstanceId === DEFAULT_PROVIDER_INSTANCE_IDS[candidate.source]) {
    return SOURCE_LABELS[candidate.source];
  }
  return (
    humanizeProviderInstanceId(candidate.providerInstanceId) || SOURCE_LABELS[candidate.source]
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export function ExternalChatImportTrigger(props: {
  readonly onOpen: () => void;
  readonly tooltipSide?: "top" | "right" | "bottom" | "left";
  readonly variant?: "default" | "sidebar-v2";
}) {
  if (props.variant === "sidebar-v2") {
    return (
      <SidebarMenuButton
        size="sm"
        className="size-7 justify-center border border-border bg-background/60 p-0 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        aria-label="Import chats"
        tooltip={{ children: "Import chats…", side: props.tooltipSide ?? "right" }}
        onClick={props.onOpen}
      >
        <ImportIcon className="size-3.5 text-muted-foreground/70" />
      </SidebarMenuButton>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Import chats"
            className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onClick={props.onOpen}
          />
        }
      >
        <ImportIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side={props.tooltipSide ?? "right"}>Import chats…</TooltipPopup>
    </Tooltip>
  );
}

export function ExternalChatImportSearchInput(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-48 flex-1">
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 pl-8"
        aria-label="Search external chats"
        placeholder="Search chats, previews, or paths"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  );
}

export interface ExternalChatEnvironmentOption {
  readonly environmentId: EnvironmentId | string;
  readonly label: string;
}

export function ExternalChatEnvironmentSelector(props: {
  readonly environments: ReadonlyArray<ExternalChatEnvironmentOption>;
  readonly environmentId: EnvironmentId | string | null;
  readonly disabled?: boolean;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | string) => void;
}) {
  if (props.environments.length <= 1) return null;
  const items = props.environments.map((environment) => ({
    value: environment.environmentId,
    label: environment.label,
  }));
  const activeEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.environmentId,
  );
  return (
    <Select
      value={props.environmentId}
      items={items}
      disabled={props.disabled}
      onValueChange={(environmentId) => {
        if (environmentId !== null) props.onEnvironmentChange(environmentId);
      }}
    >
      <SelectTrigger size="sm" className="w-auto min-w-36" aria-label="Import from environment">
        <SelectValue>{activeEnvironment?.label ?? "Choose environment"}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {props.environments.map((environment) => (
          <SelectItem key={environment.environmentId} value={environment.environmentId}>
            {environment.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function ExternalChatErrorAlert(props: {
  readonly kind: "list" | "refresh" | "import";
  readonly message: string;
}) {
  const title =
    props.kind === "list"
      ? "External chats unavailable"
      : props.kind === "refresh"
        ? "Refresh failed"
        : "Import failed";
  return (
    <Alert variant="error">
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  );
}

export function ExternalChatRefreshButton(props: {
  readonly isRefreshing: boolean;
  readonly isImporting: boolean;
  readonly onRefresh: () => void;
}) {
  const disabled = props.isRefreshing || props.isImporting;
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={disabled}
      onClick={() => {
        if (!disabled) props.onRefresh();
      }}
    >
      <RefreshCwIcon className={cn(props.isRefreshing && "animate-spin")} />
      <span className="sr-only">Refresh chats</span>
    </Button>
  );
}

export function ExternalChatImportActionButton(props: {
  readonly selectedCount: number;
  readonly hasUnresolvedCandidates: boolean;
  readonly hasEnvironment: boolean;
  readonly isRefreshing: boolean;
  readonly isImporting: boolean;
  readonly onImport: () => void;
}) {
  const disabled =
    props.selectedCount === 0 ||
    props.hasUnresolvedCandidates ||
    !props.hasEnvironment ||
    props.isRefreshing ||
    props.isImporting;
  return (
    <Button
      disabled={disabled}
      onClick={() => {
        if (!disabled) props.onImport();
      }}
    >
      {props.isImporting ? <LoaderCircleIcon className="animate-spin" /> : <ImportIcon />}
      {props.isImporting
        ? "Importing…"
        : `Import ${props.selectedCount || ""} chat${props.selectedCount === 1 ? "" : "s"}`}
    </Button>
  );
}

export function ExternalChatImportDialogFrame(props: {
  readonly open: boolean;
  readonly isImporting: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && props.isImporting) return;
        props.onOpenChange(open);
      }}
    >
      {props.children}
    </Dialog>
  );
}

export function ExternalChatCandidateRow(props: {
  readonly candidate: ExternalChatCandidate;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly destinationProjectId: ProjectId | string | null;
  readonly projects: ReadonlyArray<ExternalChatImportProject>;
  readonly error: string | null;
  readonly onSelect: () => void;
  readonly onProjectChange: (projectId: ProjectId | string) => void;
  readonly onOpenImported: (threadId: ThreadId) => void;
}) {
  const state = getExternalChatCandidateState(props.candidate);
  const destination = props.projects.find((project) => project.id === props.destinationProjectId);
  const providerLabel = externalChatProviderLabel(props.candidate);
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[SOURCE_DRIVER_KINDS[props.candidate.source]];
  return (
    <div
      className={cn(
        "rounded-xl border bg-background px-3 py-2.5 transition-colors",
        props.selected && "border-primary/35 bg-primary/[0.025]",
        props.error && "border-destructive/35",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Checkbox
          className="mt-0.5"
          checked={props.selected}
          disabled={props.disabled || !state.canSelect}
          aria-label={`Select ${props.candidate.title}`}
          onCheckedChange={() => {
            if (!props.disabled) props.onSelect();
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{props.candidate.title}</span>
            {ProviderIcon ? (
              <span
                className="inline-flex size-4 shrink-0 items-center justify-center"
                role="img"
                aria-label={providerLabel}
              >
                <ProviderIcon aria-hidden="true" className="size-3.5" />
              </span>
            ) : null}
            <Badge
              variant={state.resumabilityLabel === "Can resume" ? "success" : "secondary"}
              size="sm"
            >
              {state.resumabilityLabel}
            </Badge>
          </div>
          {props.candidate.preview ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {props.candidate.preview}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/75">
            <span>{formatRelativeTimeLabel(props.candidate.updatedAt)}</span>
            <span className="inline-flex items-center gap-1">
              <MessageSquareIcon className="size-3" />
              {props.candidate.messageCount} messages
            </span>
            <span>{providerLabel}</span>
          </div>
          {state.resumabilityReason ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{state.resumabilityReason}</p>
          ) : null}
          {props.selected ? (
            <div className="mt-2">
              {destination ? (
                <span className="text-xs text-muted-foreground">
                  Import to <span className="font-medium text-foreground">{destination.title}</span>
                </span>
              ) : (
                <Select
                  value={props.destinationProjectId}
                  disabled={props.disabled}
                  onValueChange={(projectId) => {
                    if (!props.disabled && projectId !== null) props.onProjectChange(projectId);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="max-w-xs"
                    aria-label={`Project for ${props.candidate.title}`}
                  >
                    <SelectValue>Choose a project</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {props.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <span className="flex min-w-0 flex-col">
                          <span>{project.title}</span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            {project.workspaceRoot}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              )}
            </div>
          ) : null}
          {props.error ? (
            <p className="mt-1.5 text-xs text-destructive-foreground">{props.error}</p>
          ) : null}
          {state.isImported && props.candidate.alreadyImportedThreadId ? (
            <Button
              className="mt-2"
              size="xs"
              variant="outline"
              disabled={props.disabled}
              onClick={() => {
                if (!props.disabled) {
                  props.onOpenImported(props.candidate.alreadyImportedThreadId!);
                }
              }}
            >
              Open imported chat
              <ExternalLinkIcon />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ExternalChatImportDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeEnvironmentId = useActiveEnvironmentId();
  const { environments } = useEnvironments();
  const availableEnvironmentIds = useMemo(
    () => environments.map((environment) => environment.environmentId),
    [environments],
  );
  const defaultEnvironmentId = useMemo(
    () =>
      resolveInitialExternalChatEnvironmentId({
        availableEnvironmentIds,
        activeEnvironmentId,
        primaryEnvironmentId,
      }),
    [activeEnvironmentId, availableEnvironmentIds, primaryEnvironmentId],
  );
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(defaultEnvironmentId);
  const allProjects = useProjects();
  const projects = useMemo(
    () =>
      allProjects
        .filter((project) => project.environmentId === environmentId)
        .map(({ id, title, workspaceRoot }) => ({ id, title, workspaceRoot })),
    [allProjects, environmentId],
  );
  const listQuery = useEnvironmentQuery(
    props.open && environmentId ? externalChatEnvironment.list({ environmentId, input: {} }) : null,
  );
  const refreshChats = useAtomCommand(externalChatEnvironment.refresh, { reportFailure: false });
  const importChats = useAtomCommand(externalChatEnvironment.import, { reportFailure: false });
  const [refreshedCandidates, setRefreshedCandidates] =
    useState<ReadonlyArray<ExternalChatCandidate> | null>(null);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<ReadonlySet<ExternalChatSource>>(
    () => new Set(["codex", "claude"]),
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<ExternalChatCandidateId>>(
    () => new Set(),
  );
  const [projectMapping, setProjectMapping] = useState<Readonly<Record<string, ProjectId>>>({});
  const [resultErrors, setResultErrors] = useState<ReadonlyMap<ExternalChatCandidateId, string>>(
    () => new Map(),
  );
  const [mutationError, setMutationError] = useState<{
    readonly kind: "refresh" | "import";
    readonly message: string;
  } | null>(null);
  const [resultSummary, setResultSummary] = useState<ReturnType<
    typeof summarizeExternalChatImport
  > | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const environmentSelectionIsExplicitRef = useRef(false);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const projectMappingRef = useRef(projectMapping);
  projectMappingRef.current = projectMapping;

  useEffect(() => {
    if (!props.open) {
      environmentSelectionIsExplicitRef.current = false;
      return;
    }
    setEnvironmentId((current) =>
      environmentSelectionIsExplicitRef.current &&
      current !== null &&
      availableEnvironmentIds.includes(current)
        ? current
        : defaultEnvironmentId,
    );
  }, [availableEnvironmentIds, defaultEnvironmentId, props.open]);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setSources(new Set(["codex", "claude"]));
    setSelectedIds(new Set());
    setProjectMapping({});
    setResultErrors(new Map());
    setResultSummary(null);
    setMutationError(null);
    setRefreshedCandidates(null);
  }, [props.open]);

  const handleEnvironmentChange = (nextEnvironmentId: EnvironmentId | string) => {
    if (isRefreshing || isImporting) return;
    environmentSelectionIsExplicitRef.current = true;
    setEnvironmentId(nextEnvironmentId as EnvironmentId);
    setSelectedIds(new Set());
    setProjectMapping({});
    setResultErrors(new Map());
    setResultSummary(null);
    setMutationError(null);
    setRefreshedCandidates(null);
  };

  const candidates = refreshedCandidates ?? listQuery.data?.candidates ?? [];
  const groups = useMemo(
    () => filterAndGroupExternalChats({ candidates, sources, query }),
    [candidates, query, sources],
  );
  const visibleSelectableIds = useMemo(
    () =>
      groups.flatMap((group) =>
        group.candidates
          .filter((candidate) => getExternalChatCandidateState(candidate).canSelect)
          .map((candidate) => candidate.candidateId),
      ),
    [groups],
  );
  const batchPlan = useMemo(
    () =>
      buildExternalChatImportBatches({
        candidates,
        selectedIds,
        projects,
        projectMapping,
      }),
    [candidates, projectMapping, projects, selectedIds],
  );
  const unresolvedIds = new Set(batchPlan.unresolvedCandidateIds);

  const toggleSource = (source: ExternalChatSource) => {
    if (isRefreshing || isImporting) return;
    setSources((current) => {
      const next = new Set(current);
      if (next.has(source) && next.size > 1) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const openThread = useCallback(
    (threadId: ThreadId) => {
      if (!environmentId || isImporting) return;
      props.onOpenChange(false);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
    },
    [environmentId, isImporting, props, router],
  );

  const handleRefresh = async () => {
    if (!environmentId || isRefreshing || isImporting) return;
    setIsRefreshing(true);
    setMutationError(null);
    const result = await refreshChats({ environmentId, input: {} });
    setIsRefreshing(false);
    if (result._tag === "Success") {
      const reconciled = reconcileExternalChatRefreshState({
        candidates: result.value.candidates,
        selectedIds: selectedIdsRef.current,
        projectMapping: projectMappingRef.current,
      });
      setRefreshedCandidates(result.value.candidates);
      setSelectedIds(reconciled.selectedIds as Set<ExternalChatCandidateId>);
      setProjectMapping(reconciled.projectMapping as Record<string, ProjectId>);
      setResultErrors(new Map());
      setResultSummary(null);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      setMutationError({
        kind: "refresh",
        message: errorMessage(
          squashAtomCommandFailure(result),
          "Could not refresh external chats.",
        ),
      });
    }
  };

  const handleImport = async () => {
    if (
      !environmentId ||
      selectedIds.size === 0 ||
      unresolvedIds.size > 0 ||
      isRefreshing ||
      isImporting
    )
      return;
    setIsImporting(true);
    setMutationError(null);
    setResultErrors(new Map());
    const results: ExternalChatImportItemResult[] = [];
    for (const batch of batchPlan.batches) {
      const outcome = await importChats({
        environmentId,
        input: { candidateIds: batch.candidateIds, projectId: batch.projectId as ProjectId },
      });
      if (outcome._tag === "Success") {
        results.push(...outcome.value.results);
      } else if (!isAtomCommandInterrupted(outcome)) {
        const message = errorMessage(
          squashAtomCommandFailure(outcome),
          "Could not import external chats.",
        );
        setMutationError({ kind: "import", message });
        results.push(
          ...failedExternalChatImportBatchResults({
            candidateIds: batch.candidateIds,
            candidates,
            error: message,
          }),
        );
      }
    }
    setIsImporting(false);
    if (results.length === 0) return;
    const summary = summarizeExternalChatImport(results);
    setResultSummary(summary);
    setResultErrors(summary.errorsByCandidateId);
    setRefreshedCandidates(applyExternalChatImportResults(candidates, results));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const result of results) {
        if (result.status !== "failed") next.delete(result.candidateId);
      }
      return next;
    });
    listQuery.refresh();
    appAtomRegistry.refresh(environmentShell.stateAtom(environmentId));
    const navigationTarget = resolveExternalChatImportNavigationTarget({ candidates, results });
    if (navigationTarget !== null) {
      if (summary.failedCount === 0) props.onOpenChange(false);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, navigationTarget)),
      });
    }
  };

  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectableIds.every((candidateId) => selectedIds.has(candidateId));
  const listError = refreshedCandidates === null ? listQuery.error : null;
  const lifecycleMutationDisabled = isRefreshing || isImporting;

  return (
    <ExternalChatImportDialogFrame
      open={props.open}
      isImporting={isImporting}
      onOpenChange={props.onOpenChange}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <DialogTitle>Import chats</DialogTitle>
              {candidates.length > 0 ? (
                <Badge variant="secondary">{candidates.length}</Badge>
              ) : null}
            </div>
            <ExternalChatEnvironmentSelector
              environments={environments}
              environmentId={environmentId}
              disabled={isRefreshing || isImporting}
              onEnvironmentChange={handleEnvironmentChange}
            />
          </div>
          <DialogDescription>
            Bring Codex and Claude conversations into T3 Code. Imported history stays readable even
            when its native session can no longer resume.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 border-y px-6 py-3">
          <ExternalChatImportSearchInput value={query} onChange={setQuery} />
          {(["codex", "claude"] as const).map((source) => (
            <Button
              key={source}
              size="sm"
              variant={sources.has(source) ? "secondary" : "outline"}
              disabled={lifecycleMutationDisabled}
              aria-pressed={sources.has(source)}
              onClick={() => toggleSource(source)}
            >
              {SOURCE_LABELS[source]}
            </Button>
          ))}
          <ExternalChatRefreshButton
            isRefreshing={isRefreshing}
            isImporting={isImporting}
            onRefresh={() => void handleRefresh()}
          />
        </div>
        <DialogPanel className="min-h-72 space-y-4 pt-4">
          {listError ? <ExternalChatErrorAlert kind="list" message={listError} /> : null}
          {mutationError ? (
            <ExternalChatErrorAlert kind={mutationError.kind} message={mutationError.message} />
          ) : null}
          {resultSummary ? (
            <Alert variant={resultSummary.failedCount > 0 ? "warning" : "success"}>
              <CheckCircle2Icon />
              <AlertTitle>
                Imported {resultSummary.importedCount} chat
                {resultSummary.importedCount === 1 ? "" : "s"}
              </AlertTitle>
              <AlertDescription>
                {resultSummary.failedCount > 0
                  ? `${resultSummary.failedCount} chat${resultSummary.failedCount === 1 ? "" : "s"} could not be imported. Review the errors below.`
                  : resultSummary.skippedCount > 0
                    ? `${resultSummary.skippedCount} already imported chat${resultSummary.skippedCount === 1 ? " was" : "s were"} skipped.`
                    : "The imported chats are now in your thread list."}
              </AlertDescription>
            </Alert>
          ) : null}
          {listQuery.isPending && listQuery.data === null && refreshedCandidates === null ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Finding native chats…
            </div>
          ) : groups.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
              <MessageSquareIcon className="size-6 text-muted-foreground/45" />
              <p className="text-sm font-medium">
                {candidates.length === 0 ? "No native chats found" : "No chats match your filters"}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {candidates.length === 0
                  ? "Refresh after Codex or Claude has created a local conversation."
                  : "Try another search or include both providers."}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="flex min-w-0 items-baseline gap-2 px-1">
                  <h3 className="text-xs font-semibold">{group.label}</h3>
                  {group.path ? (
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {group.path}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {group.candidates.map((candidate) => {
                    const resolvedProject = resolveExternalChatProject(candidate, projects);
                    const destinationProjectId =
                      resolvedProject?.id ?? projectMapping[candidate.candidateId] ?? null;
                    return (
                      <ExternalChatCandidateRow
                        key={candidate.candidateId}
                        candidate={candidate}
                        selected={selectedIds.has(candidate.candidateId)}
                        disabled={lifecycleMutationDisabled}
                        destinationProjectId={destinationProjectId}
                        projects={projects}
                        error={
                          resultErrors.get(candidate.candidateId) ??
                          (selectedIds.has(candidate.candidateId) &&
                          unresolvedIds.has(candidate.candidateId)
                            ? "Choose a project before importing."
                            : null)
                        }
                        onSelect={() =>
                          !lifecycleMutationDisabled &&
                          setSelectedIds(
                            (current) =>
                              toggleExternalChatSelection(
                                current,
                                candidate,
                              ) as Set<ExternalChatCandidateId>,
                          )
                        }
                        onProjectChange={(projectId) =>
                          !lifecycleMutationDisabled &&
                          setProjectMapping((current) => ({
                            ...current,
                            [candidate.candidateId]: projectId as ProjectId,
                          }))
                        }
                        onOpenImported={openThread}
                      />
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </DialogPanel>
        <DialogFooter className="sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 self-start text-xs text-muted-foreground sm:self-center">
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={
                !allVisibleSelected &&
                visibleSelectableIds.some((candidateId) => selectedIds.has(candidateId))
              }
              disabled={visibleSelectableIds.length === 0 || lifecycleMutationDisabled}
              onCheckedChange={() => {
                if (lifecycleMutationDisabled) return;
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (allVisibleSelected) {
                    for (const candidateId of visibleSelectableIds) next.delete(candidateId);
                  } else {
                    for (const candidateId of visibleSelectableIds) next.add(candidateId);
                  }
                  return next;
                });
              }}
            />
            Select visible
          </label>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={isImporting}
              onClick={() => {
                if (!isImporting) props.onOpenChange(false);
              }}
            >
              Close
            </Button>
            <ExternalChatImportActionButton
              selectedCount={selectedIds.size}
              hasUnresolvedCandidates={unresolvedIds.size > 0}
              hasEnvironment={environmentId !== null}
              isRefreshing={isRefreshing}
              isImporting={isImporting}
              onImport={() => void handleImport()}
            />
          </div>
        </DialogFooter>
      </DialogPopup>
    </ExternalChatImportDialogFrame>
  );
}

export function ExternalChatImportSidebarAction(props: {
  readonly tooltipSide?: "top" | "right" | "bottom" | "left";
  readonly variant?: "default" | "sidebar-v2";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ExternalChatImportTrigger
        onOpen={() => setOpen(true)}
        {...(props.tooltipSide === undefined ? {} : { tooltipSide: props.tooltipSide })}
        {...(props.variant === undefined ? {} : { variant: props.variant })}
      />
      <ExternalChatImportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
