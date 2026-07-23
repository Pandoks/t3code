import type { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import type { ContextWindowSnapshot } from "~/lib/contextWindow";
import { ContextWindowMeter } from "../ContextWindowMeter";
import { ProviderUsagePopover } from "./ProviderUsagePopover";

export function ComposerFooterUsageIndicators(props: {
  readonly environmentId: EnvironmentId;
  readonly activeProviderInstanceId: ProviderInstanceId;
  readonly activeProviderDriver: ProviderDriverKind;
  readonly activeProviderDisplayName: string;
  readonly activeContextWindow: ContextWindowSnapshot | null;
  readonly activeThreadProviderDisplayName: string | null;
}) {
  return (
    <>
      {props.activeContextWindow ? (
        <ContextWindowMeter
          usage={props.activeContextWindow}
          providerDisplayName={props.activeThreadProviderDisplayName}
        />
      ) : null}
      <ProviderUsagePopover
        environmentId={props.environmentId}
        activeInstanceId={props.activeProviderInstanceId}
        activeDriver={props.activeProviderDriver}
        activeProviderDisplayName={props.activeProviderDisplayName}
      />
    </>
  );
}
