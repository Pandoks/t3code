import type {
  ExternalChatCandidate,
  ExternalChatCandidateId,
  ExternalChatImportItemResult,
  ExternalChatSource,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
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
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAtomCommand } from "../state/use-atom-command";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  applyExternalChatImportResults,
  buildExternalChatImportBatches,
  filterAndGroupExternalChats,
  getExternalChatCandidateState,
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export function ExternalChatImportTrigger(props: {
  readonly onOpen: () => void;
  readonly tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
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

export function ExternalChatCandidateRow(props: {
  readonly candidate: ExternalChatCandidate;
  readonly selected: boolean;
  readonly destinationProjectId: ProjectId | string | null;
  readonly projects: ReadonlyArray<ExternalChatImportProject>;
  readonly error: string | null;
  readonly onSelect: () => void;
  readonly onProjectChange: (projectId: ProjectId | string) => void;
  readonly onOpenImported: (threadId: ThreadId) => void;
}) {
  const state = getExternalChatCandidateState(props.candidate);
  const destination = props.projects.find((project) => project.id === props.destinationProjectId);
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
          disabled={!state.canSelect}
          aria-label={`Select ${props.candidate.title}`}
          onCheckedChange={props.onSelect}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{props.candidate.title}</span>
            <Badge variant="outline" size="sm">
              {SOURCE_LABELS[props.candidate.source]}
            </Badge>
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
            <span className="font-mono">{props.candidate.providerInstanceId}</span>
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
                  onValueChange={(projectId) => {
                    if (projectId !== null) props.onProjectChange(projectId);
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
              onClick={() => props.onOpenImported(props.candidate.alreadyImportedThreadId!)}
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
  const environmentId = usePrimaryEnvironmentId();
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
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<ReturnType<
    typeof summarizeExternalChatImport
  > | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setSources(new Set(["codex", "claude"]));
    setSelectedIds(new Set());
    setProjectMapping({});
    setResultErrors(new Map());
    setResultSummary(null);
    setGlobalError(null);
    setRefreshedCandidates(null);
  }, [props.open]);

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
    setSources((current) => {
      const next = new Set(current);
      if (next.has(source) && next.size > 1) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const openThread = useCallback(
    (threadId: ThreadId) => {
      if (!environmentId) return;
      props.onOpenChange(false);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
    },
    [environmentId, props, router],
  );

  const handleRefresh = async () => {
    if (!environmentId || isRefreshing) return;
    setIsRefreshing(true);
    setGlobalError(null);
    const result = await refreshChats({ environmentId, input: {} });
    setIsRefreshing(false);
    if (result._tag === "Success") {
      setRefreshedCandidates(result.value.candidates);
      setResultErrors(new Map());
      setResultSummary(null);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      setGlobalError(
        errorMessage(squashAtomCommandFailure(result), "Could not refresh external chats."),
      );
    }
  };

  const handleImport = async () => {
    if (!environmentId || selectedIds.size === 0 || unresolvedIds.size > 0 || isImporting) return;
    setIsImporting(true);
    setGlobalError(null);
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
        setGlobalError(
          errorMessage(squashAtomCommandFailure(outcome), "Could not import external chats."),
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

  const listError = globalError ?? listQuery.error;
  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectableIds.every((candidateId) => selectedIds.has(candidateId));

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Import chats</DialogTitle>
            {candidates.length > 0 ? <Badge variant="secondary">{candidates.length}</Badge> : null}
          </div>
          <DialogDescription>
            Bring Codex and Claude conversations into T3 Code. Imported history stays readable even
            when its native session can no longer resume.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 border-y px-6 py-3">
          <div className="relative min-w-48 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8"
              placeholder="Search chats, previews, or paths"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          {(["codex", "claude"] as const).map((source) => (
            <Button
              key={source}
              size="sm"
              variant={sources.has(source) ? "secondary" : "outline"}
              aria-pressed={sources.has(source)}
              onClick={() => toggleSource(source)}
            >
              {SOURCE_LABELS[source]}
            </Button>
          ))}
          <Button size="icon-sm" variant="ghost" onClick={() => void handleRefresh()}>
            <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
            <span className="sr-only">Refresh chats</span>
          </Button>
        </div>
        <DialogPanel className="min-h-72 space-y-4 pt-4">
          {listError ? (
            <Alert variant="error">
              <AlertCircleIcon />
              <AlertTitle>External chats unavailable</AlertTitle>
              <AlertDescription>{listError}</AlertDescription>
            </Alert>
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
                          setSelectedIds(
                            (current) =>
                              toggleExternalChatSelection(
                                current,
                                candidate,
                              ) as Set<ExternalChatCandidateId>,
                          )
                        }
                        onProjectChange={(projectId) =>
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
              disabled={visibleSelectableIds.length === 0 || isImporting}
              onCheckedChange={() =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (allVisibleSelected) {
                    for (const candidateId of visibleSelectableIds) next.delete(candidateId);
                  } else {
                    for (const candidateId of visibleSelectableIds) next.add(candidateId);
                  }
                  return next;
                })
              }
            />
            Select visible
          </label>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={isImporting}
              onClick={() => props.onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              disabled={
                selectedIds.size === 0 || unresolvedIds.size > 0 || isImporting || !environmentId
              }
              onClick={() => void handleImport()}
            >
              {isImporting ? <LoaderCircleIcon className="animate-spin" /> : <ImportIcon />}
              {isImporting
                ? "Importing…"
                : `Import ${selectedIds.size || ""} chat${selectedIds.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ExternalChatImportSidebarAction(props: {
  readonly tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ExternalChatImportTrigger
        onOpen={() => setOpen(true)}
        {...(props.tooltipSide === undefined ? {} : { tooltipSide: props.tooltipSide })}
      />
      <ExternalChatImportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
