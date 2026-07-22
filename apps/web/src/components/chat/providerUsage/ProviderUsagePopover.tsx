import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";

import { providerUsageEnvironment } from "~/state/providerUsage";
import { useAtomCommand } from "~/state/use-atom-command";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ProviderUsageDashboard } from "./ProviderUsageDashboard";
import { ProviderUsageTrigger } from "./ProviderUsageTrigger";
import {
  filterSupportedProviderUsageSnapshots,
  isProviderUsageDriver,
  reconcileProviderUsageSelectedInstanceId,
  resolveProviderUsageSelectedInstanceId,
  shouldRefreshProviderUsageOnOpen,
} from "./providerUsagePopoverLogic";

interface ProviderUsagePopoverProps {
  readonly environmentId: EnvironmentId;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeDriver: ProviderDriverKind;
  readonly activeProviderDisplayName: string;
}

export function ProviderUsagePopover(props: ProviderUsagePopoverProps) {
  if (!isProviderUsageDriver(props.activeDriver)) return null;
  return <SupportedProviderUsagePopover {...props} />;
}

function SupportedProviderUsagePopover(props: ProviderUsagePopoverProps) {
  const [open, setOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | null>(
    props.activeInstanceId,
  );
  const previousActiveInstanceIdRef = useRef(props.activeInstanceId);
  const [refreshingInstanceId, setRefreshingInstanceId] = useState<ProviderInstanceId | null>(null);
  const result = useAtomValue(
    providerUsageEnvironment.snapshots({ environmentId: props.environmentId, input: {} }),
  );
  const refreshUsage = useAtomCommand(providerUsageEnvironment.refresh, {
    reportFailure: false,
  });
  const snapshots = useMemo(
    () =>
      filterSupportedProviderUsageSnapshots(
        Option.getOrNull(AsyncResult.value(result))?.snapshots ?? [],
      ),
    [result],
  );
  const inspectedSelectedInstanceId = reconcileProviderUsageSelectedInstanceId({
    selectedInstanceId: selectedInstanceId ?? props.activeInstanceId,
    previousActiveInstanceId: previousActiveInstanceIdRef.current,
    activeInstanceId: props.activeInstanceId,
  });
  const effectiveSelectedInstanceId = resolveProviderUsageSelectedInstanceId({
    snapshots,
    selectedInstanceId: inspectedSelectedInstanceId,
    activeInstanceId: props.activeInstanceId,
  });
  const selectedSnapshot = snapshots.find(
    (snapshot) => snapshot.instanceId === effectiveSelectedInstanceId,
  );

  useEffect(() => {
    if (previousActiveInstanceIdRef.current === props.activeInstanceId) return;
    previousActiveInstanceIdRef.current = props.activeInstanceId;
    setSelectedInstanceId(props.activeInstanceId);
  }, [props.activeInstanceId]);

  const refresh = async (instanceId: ProviderInstanceId) => {
    setRefreshingInstanceId(instanceId);
    try {
      await refreshUsage({
        environmentId: props.environmentId,
        input: { instanceId },
      });
    } finally {
      setRefreshingInstanceId((current) => (current === instanceId ? null : current));
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (
      nextOpen &&
      !open &&
      selectedSnapshot &&
      shouldRefreshProviderUsageOnOpen(selectedSnapshot, new Date())
    ) {
      void refresh(selectedSnapshot.instanceId);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <ProviderUsageTrigger
                  providerDisplayName={props.activeProviderDisplayName}
                  expanded={open}
                />
              }
            />
          }
        />
        <TooltipPopup side="top">Provider usage</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        side="top"
        align="end"
        className="p-0 [--viewport-inline-padding:0]"
        viewportClassName="p-0"
      >
        <ProviderUsageDashboard
          snapshots={snapshots}
          selectedInstanceId={effectiveSelectedInstanceId}
          refreshing={
            refreshingInstanceId === effectiveSelectedInstanceId ||
            selectedSnapshot?.status === "refreshing"
          }
          onSelectInstance={setSelectedInstanceId}
          onRefresh={(instanceId) => void refresh(instanceId)}
        />
      </PopoverPopup>
    </Popover>
  );
}
