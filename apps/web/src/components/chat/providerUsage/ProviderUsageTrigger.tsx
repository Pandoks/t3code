import type { ProviderDriverKind } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { Button } from "../../ui/button";
import { PROVIDER_USAGE_COLORS } from "./providerUsagePresentation";

type ProviderUsageTriggerProps = Omit<ComponentProps<typeof Button>, "children"> & {
  readonly providerDriver: ProviderDriverKind;
  readonly providerDisplayName: string;
  readonly expanded: boolean;
  readonly remainingLevels?: ReadonlyArray<number>;
};

const EMPTY_REMAINING_LEVELS: ReadonlyArray<number> = [];

export function ProviderUsageTrigger({
  providerDriver,
  providerDisplayName,
  expanded,
  remainingLevels = EMPTY_REMAINING_LEVELS,
  style,
  ...buttonProps
}: ProviderUsageTriggerProps) {
  const primaryY = remainingLevels.length > 1 ? 4 : 6.75;
  const providerColor =
    providerDriver === "claudeAgent" ? PROVIDER_USAGE_COLORS.claude : PROVIDER_USAGE_COLORS.codex;
  return (
    <Button
      {...buttonProps}
      type="button"
      size="icon-xs"
      variant="outline"
      aria-label={`${providerDisplayName} provider usage`}
      aria-expanded={expanded}
      className="size-6 hover:opacity-90 data-pressed:opacity-80 sm:size-6"
      style={{
        ...style,
        color: providerColor,
        borderColor: providerColor,
        backgroundColor: `color-mix(in oklab, ${providerColor} 10%, transparent)`,
      }}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="size-3.5"
        style={{ color: providerColor }}
        data-provider-usage-glyph="true"
      >
        <rect
          x="3"
          y={primaryY}
          width="10"
          height="2.5"
          rx="1.25"
          fill="currentColor"
          opacity="0.25"
          data-provider-usage-track="primary"
        />
        <rect
          x="3"
          y={primaryY}
          width={levelWidth(remainingLevels[0])}
          height="2.5"
          rx="1.25"
          fill="currentColor"
          data-provider-usage-fill="primary"
        />
        {remainingLevels.length > 1 ? (
          <>
            <rect
              x="3"
              y="9.5"
              width="10"
              height="2.5"
              rx="1.25"
              fill="currentColor"
              opacity="0.25"
              data-provider-usage-track="secondary"
            />
            <rect
              x="3"
              y="9.5"
              width={levelWidth(remainingLevels[1])}
              height="2.5"
              rx="1.25"
              fill="currentColor"
              data-provider-usage-fill="secondary"
            />
          </>
        ) : null}
      </svg>
    </Button>
  );
}

function levelWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(100, value))) / 10;
}
