import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./ProviderUsagePopover", () => ({
  ProviderUsagePopover: () => <span data-testid="provider-usage" />,
}));

import { ComposerFooterUsageIndicators } from "./ComposerFooterUsageIndicators";

describe("ComposerFooterUsageIndicators", () => {
  it("renders context usage before provider usage", () => {
    const markup = renderToStaticMarkup(
      <ComposerFooterUsageIndicators
        environmentId={EnvironmentId.make("environment-local")}
        activeProviderInstanceId={ProviderInstanceId.make("codex")}
        activeProviderDriver={ProviderDriverKind.make("codex")}
        activeProviderDisplayName="Codex"
        activeContextWindow={{
          usedTokens: 10_000,
          maxTokens: 100_000,
          usedPercentage: 10,
          remainingTokens: 90_000,
          remainingPercentage: 90,
          totalProcessedTokens: 10_000,
          compactsAutomatically: true,
          updatedAt: "2026-07-22T12:00:00.000Z",
        }}
        activeThreadProviderDisplayName="Codex"
      />,
    );

    expect(markup.indexOf("Context window 10% used")).toBeLessThan(
      markup.indexOf('data-testid="provider-usage"'),
    );
  });
});
