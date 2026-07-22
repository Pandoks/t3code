import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderUsageSnapshot,
} from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "../../ui/button";
import { ProviderInstanceIcon } from "../ProviderInstanceIcon";
import { cn } from "~/lib/utils";
import {
  formatProviderUsageCost,
  formatProviderUsagePercent,
  formatProviderUsageRelativeTime,
  formatProviderUsageReset,
  formatProviderUsageTokens,
  PROVIDER_USAGE_COLORS,
  orderProviderUsageWindows,
  providerUsageBarHeight,
} from "./providerUsagePresentation";

export type ProviderUsageDashboardSnapshot = ProviderUsageSnapshot;

function providerColor(driver: ProviderDriverKind): string {
  if (driver === "claudeAgent") return PROVIDER_USAGE_COLORS.claude;
  return PROVIDER_USAGE_COLORS.codex;
}

export function ProviderUsageDashboard(props: {
  readonly snapshots: ReadonlyArray<ProviderUsageDashboardSnapshot>;
  readonly selectedInstanceId: ProviderInstanceId | null;
  readonly now?: Date;
  readonly refreshing?: boolean;
  readonly onSelectInstance: (instanceId: ProviderInstanceId) => void;
  readonly onRefresh: (instanceId: ProviderInstanceId) => void;
}) {
  const selected =
    props.snapshots.find((item) => item.instanceId === props.selectedInstanceId) ??
    props.snapshots[0] ??
    null;
  const now = props.now ?? new Date();
  const tabGroupId = useId();

  if (selected === null) {
    return (
      <div className="flex min-h-44 w-92 items-center justify-center p-6 text-center text-muted-foreground text-sm">
        Provider usage is not available yet.
      </div>
    );
  }

  const headline =
    selected.windows.find((window) => window.id === selected.headlineWindowId) ??
    selected.windows[0] ??
    null;
  const color = providerColor(selected.driver);
  const isCodex = selected.driver === "codex";
  const windows = orderProviderUsageWindows(selected.driver, selected.windows);
  const hasProviderTabs = props.snapshots.length > 1;
  const selectedTabId = `${tabGroupId}-tab-${selected.instanceId}`;
  const panelId = `${tabGroupId}-panel`;
  const maximumDailyTokens = Math.max(
    0,
    ...(selected.history?.daily.map((day) => day.totalTokens) ?? []),
  );

  return (
    <div className="w-92 max-w-[calc(100vw-1rem)] overflow-hidden">
      {hasProviderTabs ? (
        <div
          className="flex gap-1 overflow-x-auto border-b bg-muted/20 p-1.5"
          role="tablist"
          aria-label="Provider usage accounts"
        >
          {props.snapshots.map((item) => {
            const active = item.instanceId === selected.instanceId;
            return (
              <Button
                key={item.instanceId}
                size="xs"
                variant="ghost"
                role="tab"
                aria-selected={active}
                id={`${tabGroupId}-tab-${item.instanceId}`}
                aria-controls={panelId}
                tabIndex={active ? 0 : -1}
                className={cn(
                  "min-w-0 gap-1.5 px-2 text-muted-foreground",
                  active && "bg-background text-foreground shadow-xs hover:bg-background",
                )}
                onClick={() => props.onSelectInstance(item.instanceId)}
              >
                <ProviderInstanceIcon
                  driverKind={item.driver}
                  displayName={item.displayName}
                  className="size-3.5"
                  iconClassName="size-3.5"
                />
                <span className="max-w-28 truncate">{item.displayName}</span>
              </Button>
            );
          })}
        </div>
      ) : null}

      <div
        {...(hasProviderTabs
          ? { role: "tabpanel", id: panelId, "aria-labelledby": selectedTabId }
          : {})}
        className="p-4"
      >
        <header className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
          >
            <ProviderInstanceIcon
              driverKind={selected.driver}
              displayName={selected.displayName}
              className="size-5"
              iconClassName="size-5"
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-sm">{selected.displayName}</div>
            <div className="mt-0.5 text-muted-foreground text-xs">
              {selected.status === "unavailable" || selected.status === "error"
                ? "Usage unavailable"
                : `Updated ${formatProviderUsageRelativeTime(selected.lastSuccessfulAt, now)}`}
            </div>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Refresh ${selected.displayName} usage`}
            disabled={props.refreshing}
            onClick={() => props.onRefresh(selected.instanceId)}
          >
            <RefreshCwIcon
              className={cn(props.refreshing && "animate-spin motion-reduce:animate-none")}
            />
          </Button>
        </header>

        {!isCodex ? (
          <section className="mt-4 flex items-end justify-between gap-4 border-b pb-4">
            <div>
              <div className="font-semibold text-2xl tabular-nums tracking-tight">
                {formatProviderUsagePercent(headline?.remainingPercent)}
                {headline ? (
                  <span className="ml-1.5 font-medium text-muted-foreground text-xs">
                    remaining
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {headline?.label ?? "Current window"}
              </div>
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              {headline ? formatProviderUsageReset(headline.resetsAt, now) : "—"}
            </div>
          </section>
        ) : null}

        <section className="mt-4 space-y-3" aria-label="Quota windows">
          {windows.map((window) => {
            const remaining = Math.max(0, Math.min(100, window.remainingPercent));
            return (
              <div key={window.id}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">{window.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatProviderUsagePercent(window.remainingPercent)} left
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${window.label} remaining`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(remaining)}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${remaining}%`, backgroundColor: color }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70">
                  <span>{formatProviderUsageReset(window.resetsAt, now)}</span>
                  {window.reservePercent !== undefined ? (
                    <span>{window.reservePercent}% reserve</span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {windows.length === 0 ? (
            <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-muted-foreground text-xs">
              {selected.message ?? "Quota details are unavailable."}
            </div>
          ) : null}
        </section>

        <section className="mt-4 border-t pt-4" aria-label="Usage history">
          {isCodex ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Metric
                label="Today"
                value={formatProviderUsageCost(selected.history?.todayEstimatedCostUsd)}
              />
              <Metric
                label="30d"
                value={formatProviderUsageCost(selected.history?.thirtyDayEstimatedCostUsd)}
              />
              <Metric
                label="Latest tokens"
                value={formatProviderUsageTokens(selected.history?.todayTokens)}
              />
              <Metric
                label="30d tokens"
                value={formatProviderUsageTokens(selected.history?.thirtyDayTokens)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <HistoryStat
                label="Today"
                tokens={selected.history?.todayTokens}
                cost={selected.history?.todayEstimatedCostUsd}
              />
              <HistoryStat
                label="30 days"
                tokens={selected.history?.thirtyDayTokens}
                cost={selected.history?.thirtyDayEstimatedCostUsd}
              />
            </div>
          )}
          {selected.history?.daily.length ? (
            <>
              {isCodex ? (
                <div className="mt-3 text-right font-medium text-[10px] text-muted-foreground tabular-nums">
                  {formatProviderUsageCost(selected.history.thirtyDayEstimatedCostUsd)}
                </div>
              ) : null}
              <div
                className="mt-1 flex h-14 items-end gap-px"
                role="img"
                aria-label="Token usage over the last 30 days"
              >
                {selected.history.daily.map((day) => (
                  <span
                    key={day.date}
                    className="min-w-0 flex-1 rounded-t-[2px] opacity-80"
                    title={`${day.date}: ${formatProviderUsageTokens(day.totalTokens)} tokens`}
                    style={{
                      height: `${providerUsageBarHeight(day.totalTokens, maximumDailyTokens)}%`,
                      backgroundColor: color,
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Top model</span>
            <span className="truncate font-medium">{selected.history?.topModel ?? "—"}</span>
          </div>
          {isCodex ? (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Estimated from token usage · not a subscription bill
            </p>
          ) : null}
        </section>

        {selected.message && selected.windows.length > 0 ? (
          <p className="mt-3 text-pretty text-[11px] text-muted-foreground">{selected.message}</p>
        ) : null}
      </div>
    </div>
  );
}

function Metric(props: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{props.label}</div>
      <div className="font-semibold text-sm tabular-nums">{props.value}</div>
    </div>
  );
}

function HistoryStat(props: {
  readonly label: string;
  readonly tokens: number | null | undefined;
  readonly cost: number | null | undefined;
}) {
  return (
    <div className="rounded-lg bg-muted/35 px-3 py-2.5">
      <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {props.label}
      </div>
      <div className="mt-1 font-semibold text-sm tabular-nums">
        {formatProviderUsageTokens(props.tokens)}
        <span className="ml-1 font-normal text-[10px] text-muted-foreground">tokens</span>
      </div>
      <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
        {formatProviderUsageCost(props.cost)} estimated
      </div>
    </div>
  );
}
