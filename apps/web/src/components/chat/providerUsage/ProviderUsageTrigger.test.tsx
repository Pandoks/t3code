import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderUsageTrigger } from "./ProviderUsageTrigger";

describe("ProviderUsageTrigger", () => {
  it("renders a compact icon-only blue usage control", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageTrigger
        providerDisplayName="Codex Work"
        expanded={false}
        remainingLevels={[49, 100]}
      />,
    );

    expect(markup).toContain('aria-label="Codex Work provider usage"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("size-6");
    expect(markup).toContain("bg-blue-500/10");
    expect(markup).toContain("text-blue-400");
    expect(markup).toContain('data-provider-usage-glyph="true"');
    expect(markup).toContain('data-provider-usage-track="primary"');
    expect(markup).toContain('data-provider-usage-fill="primary"');
    expect(markup).toContain('width="4.9"');
    expect(markup).toContain('data-provider-usage-fill="secondary"');
    expect(markup).toContain('width="10"');
    expect(markup).not.toContain("lucide");
    expect(markup).not.toContain(">Usage<");
  });
});
