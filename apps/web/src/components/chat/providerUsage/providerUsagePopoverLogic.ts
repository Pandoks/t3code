import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderUsageSnapshot,
} from "@t3tools/contracts";

const MAX_OPEN_AGE_MS = 60_000;

export function isProviderUsageDriver(driver: ProviderDriverKind): boolean {
  return driver === "codex" || driver === "claudeAgent";
}

export function filterSupportedProviderUsageSnapshots(
  snapshots: ReadonlyArray<ProviderUsageSnapshot>,
): ReadonlyArray<ProviderUsageSnapshot> {
  return snapshots.filter((snapshot) => isProviderUsageDriver(snapshot.driver));
}

export function resolveProviderUsageSelectedInstanceId(input: {
  readonly snapshots: ReadonlyArray<ProviderUsageSnapshot>;
  readonly selectedInstanceId: ProviderInstanceId | null;
  readonly activeInstanceId: ProviderInstanceId;
}): ProviderInstanceId | null {
  if (input.snapshots.some((snapshot) => snapshot.instanceId === input.selectedInstanceId)) {
    return input.selectedInstanceId;
  }
  if (input.snapshots.some((snapshot) => snapshot.instanceId === input.activeInstanceId)) {
    return input.activeInstanceId;
  }
  return input.snapshots[0]?.instanceId ?? null;
}

export function reconcileProviderUsageSelectedInstanceId(input: {
  readonly selectedInstanceId: ProviderInstanceId;
  readonly previousActiveInstanceId: ProviderInstanceId;
  readonly activeInstanceId: ProviderInstanceId;
}): ProviderInstanceId {
  return input.previousActiveInstanceId === input.activeInstanceId
    ? input.selectedInstanceId
    : input.activeInstanceId;
}

export function shouldRefreshProviderUsageOnOpen(
  snapshot: ProviderUsageSnapshot,
  now: Date,
): boolean {
  if (snapshot.status === "refreshing") return false;
  if (
    snapshot.status === "stale" ||
    snapshot.status === "error" ||
    snapshot.status === "unavailable"
  ) {
    return true;
  }
  const freshnessTimestamp = snapshot.lastSuccessfulAt ?? snapshot.checkedAt;
  const freshnessTime = Date.parse(freshnessTimestamp);
  return !Number.isFinite(freshnessTime) || now.getTime() - freshnessTime > MAX_OPEN_AGE_MS;
}
