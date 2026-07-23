import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderUsagePopover } from "./ProviderUsagePopover";

describe("ProviderUsagePopover", () => {
  it("does not render for a chat using an unsupported provider", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsagePopover
        environmentId={EnvironmentId.make("environment-local")}
        activeInstanceId={ProviderInstanceId.make("open-code")}
        activeDriver={ProviderDriverKind.make("opencode")}
        activeProviderDisplayName="OpenCode"
      />,
    );

    expect(markup).toBe("");
  });
});
