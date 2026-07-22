import type { ComponentProps } from "react";

import { Button } from "../../ui/button";

type ProviderUsageTriggerProps = Omit<ComponentProps<typeof Button>, "children"> & {
  readonly providerDisplayName: string;
  readonly expanded: boolean;
};

export function ProviderUsageTrigger({
  providerDisplayName,
  expanded,
  ...buttonProps
}: ProviderUsageTriggerProps) {
  return (
    <Button
      {...buttonProps}
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={`${providerDisplayName} provider usage`}
      aria-expanded={expanded}
      className="size-6 bg-blue-500/10 text-blue-500 hover:bg-blue-500/15 hover:text-blue-500 data-pressed:bg-blue-500/15 data-pressed:text-blue-500 sm:size-6"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="size-3.5"
        fill="currentColor"
        data-provider-usage-glyph="true"
      >
        <rect x="3" y="4" width="10" height="3" rx="1.5" />
        <rect x="3" y="9" width="7" height="3" rx="1.5" />
      </svg>
    </Button>
  );
}
