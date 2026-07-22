import type { ComponentProps } from "react";

import { Button } from "../../ui/button";

type ProviderUsageTriggerProps = Omit<ComponentProps<typeof Button>, "children"> & {
  readonly providerDisplayName: string;
  readonly expanded: boolean;
  readonly remainingLevels?: ReadonlyArray<number>;
};

const EMPTY_REMAINING_LEVELS: ReadonlyArray<number> = [];

export function ProviderUsageTrigger({
  providerDisplayName,
  expanded,
  remainingLevels = EMPTY_REMAINING_LEVELS,
  ...buttonProps
}: ProviderUsageTriggerProps) {
  const primaryY = remainingLevels.length > 1 ? 4 : 6.75;
  return (
    <Button
      {...buttonProps}
      type="button"
      size="icon-xs"
      variant="outline"
      aria-label={`${providerDisplayName} provider usage`}
      aria-expanded={expanded}
      className="size-6 border-blue-500 bg-blue-500/10 text-blue-400 hover:border-blue-400 hover:bg-blue-500/15 hover:text-blue-300 data-pressed:border-blue-400 data-pressed:bg-blue-500/20 data-pressed:text-blue-300 sm:size-6"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="size-3.5"
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
