import type {
  ExternalChatCandidate,
  ExternalChatCandidateId,
  ExternalChatImportItemResult,
  ExternalChatSource,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

export interface ExternalChatImportProject {
  readonly id: ProjectId | string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface ExternalChatGroup {
  readonly key: string;
  readonly label: string;
  readonly path: string | null;
  readonly candidates: ReadonlyArray<ExternalChatCandidate>;
}

export interface ExternalChatImportBatch {
  readonly projectId: ProjectId | string;
  readonly candidateIds: ReadonlyArray<ExternalChatCandidateId>;
}

function normalizePath(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.length === 0 ? "/" : normalized;
}

function pathContains(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

export function resolveExternalChatProject(
  candidate: ExternalChatCandidate,
  projects: ReadonlyArray<ExternalChatImportProject>,
): ExternalChatImportProject | null {
  if (!candidate.cwd) return null;
  return (
    projects
      .filter((project) => pathContains(project.workspaceRoot, candidate.cwd!))
      .toSorted(
        (left, right) =>
          normalizePath(right.workspaceRoot).length - normalizePath(left.workspaceRoot).length,
      )[0] ?? null
  );
}

function groupLabel(path: string | null): string {
  if (path === null) return "Unresolved project";
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

export function filterAndGroupExternalChats(input: {
  readonly candidates: ReadonlyArray<ExternalChatCandidate>;
  readonly sources: ReadonlySet<ExternalChatSource>;
  readonly query: string;
}): ExternalChatGroup[] {
  const query = input.query.trim().toLocaleLowerCase();
  const groups = new Map<string, ExternalChatCandidate[]>();
  for (const candidate of input.candidates) {
    if (!input.sources.has(candidate.source)) continue;
    const searchable = [candidate.title, candidate.preview, candidate.projectPath, candidate.cwd]
      .filter((value): value is string => value !== undefined)
      .join("\n")
      .toLocaleLowerCase();
    if (query.length > 0 && !searchable.includes(query)) continue;
    const path = candidate.projectPath ?? candidate.cwd ?? null;
    const key = path ?? "__unresolved__";
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }
  return [...groups].map(([key, candidates]) => {
    const path = key === "__unresolved__" ? null : key;
    return { key, label: groupLabel(path), path, candidates };
  });
}

export function getExternalChatCandidateState(candidate: ExternalChatCandidate): {
  readonly canSelect: boolean;
  readonly isImported: boolean;
  readonly resumabilityLabel: "Can resume" | "Read-only" | "Resume unknown";
  readonly resumabilityReason: string | null;
} {
  const isImported = candidate.alreadyImportedThreadId !== undefined;
  return {
    canSelect: !isImported,
    isImported,
    resumabilityLabel:
      candidate.resumability.status === "resumable"
        ? "Can resume"
        : candidate.resumability.status === "not_resumable"
          ? "Read-only"
          : "Resume unknown",
    resumabilityReason: candidate.resumability.reason ?? null,
  };
}

export function toggleExternalChatSelection(
  selectedIds: ReadonlySet<ExternalChatCandidateId | string>,
  candidate: ExternalChatCandidate,
): Set<ExternalChatCandidateId | string> {
  if (!getExternalChatCandidateState(candidate).canSelect) return new Set(selectedIds);
  const next = new Set(selectedIds);
  if (next.has(candidate.candidateId)) next.delete(candidate.candidateId);
  else next.add(candidate.candidateId);
  return next;
}

export function buildExternalChatImportBatches(input: {
  readonly candidates: ReadonlyArray<ExternalChatCandidate>;
  readonly selectedIds: ReadonlySet<ExternalChatCandidateId | string>;
  readonly projects: ReadonlyArray<ExternalChatImportProject>;
  readonly projectMapping: Readonly<Record<string, ProjectId | string | undefined>>;
}): {
  readonly batches: ExternalChatImportBatch[];
  readonly unresolvedCandidateIds: ExternalChatCandidateId[];
} {
  const candidateIdsByProject = new Map<ProjectId | string, ExternalChatCandidateId[]>();
  const unresolvedCandidateIds: ExternalChatCandidateId[] = [];
  for (const candidate of input.candidates) {
    if (!input.selectedIds.has(candidate.candidateId)) continue;
    const projectId =
      resolveExternalChatProject(candidate, input.projects)?.id ??
      input.projectMapping[candidate.candidateId];
    if (projectId === undefined) {
      unresolvedCandidateIds.push(candidate.candidateId);
      continue;
    }
    const ids = candidateIdsByProject.get(projectId);
    if (ids) ids.push(candidate.candidateId);
    else candidateIdsByProject.set(projectId, [candidate.candidateId]);
  }
  return {
    batches: [...candidateIdsByProject].map(([projectId, candidateIds]) => ({
      projectId,
      candidateIds,
    })),
    unresolvedCandidateIds,
  };
}

export function summarizeExternalChatImport(results: ReadonlyArray<ExternalChatImportItemResult>): {
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly errorsByCandidateId: ReadonlyMap<ExternalChatCandidateId, string>;
} {
  const errorsByCandidateId = new Map<ExternalChatCandidateId, string>();
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const result of results) {
    if (result.status === "imported") importedCount += 1;
    else if (result.status === "skipped") skippedCount += 1;
    else {
      failedCount += 1;
      errorsByCandidateId.set(result.candidateId, result.error ?? "Import failed.");
    }
  }
  return { importedCount, skippedCount, failedCount, errorsByCandidateId };
}

export function applyExternalChatImportResults(
  candidates: ReadonlyArray<ExternalChatCandidate>,
  results: ReadonlyArray<ExternalChatImportItemResult>,
): ExternalChatCandidate[] {
  const importedThreadIdByCandidateId = new Map<ExternalChatCandidateId, ThreadId>();
  for (const result of results) {
    if (result.threadId !== undefined && result.status !== "failed") {
      importedThreadIdByCandidateId.set(result.candidateId, result.threadId);
    }
  }
  return candidates.map((candidate) => {
    const threadId = importedThreadIdByCandidateId.get(candidate.candidateId);
    return threadId === undefined ? candidate : { ...candidate, alreadyImportedThreadId: threadId };
  });
}

export function resolveExternalChatImportNavigationTarget(input: {
  readonly candidates: ReadonlyArray<ExternalChatCandidate>;
  readonly results: ReadonlyArray<ExternalChatImportItemResult>;
}): ThreadId | null {
  const candidatesById = new Map(
    input.candidates.map((candidate) => [candidate.candidateId, candidate] as const),
  );
  return (
    input.results
      .filter(
        (result): result is ExternalChatImportItemResult & { readonly threadId: ThreadId } =>
          result.status === "imported" && result.threadId !== undefined,
      )
      .toSorted((left, right) => {
        const leftUpdatedAt = candidatesById.get(left.candidateId)?.updatedAt ?? "";
        const rightUpdatedAt = candidatesById.get(right.candidateId)?.updatedAt ?? "";
        return rightUpdatedAt.localeCompare(leftUpdatedAt);
      })[0]?.threadId ?? null
  );
}
