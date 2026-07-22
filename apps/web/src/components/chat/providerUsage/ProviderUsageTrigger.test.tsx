import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderUsageTrigger } from "./ProviderUsageTrigger";

describe("ProviderUsageTrigger", () => {
  it("renders a compact icon-only blue usage control", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageTrigger providerDisplayName="Codex Work" expanded={false} />,
    );

    expect(markup).toContain('aria-label="Codex Work provider usage"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("size-6");
    expect(markup).toContain("bg-blue-500/10");
    expect(markup).toContain("text-blue-500");
    expect(markup).toContain('data-provider-usage-glyph="true"');
    expect(markup.match(/<rect/g)).toHaveLength(2);
    expect(markup).toContain('<rect x="3" y="4" width="10" height="3" rx="1.5"');
    expect(markup).toContain('<rect x="3" y="9" width="7" height="3" rx="1.5"');
    expect(markup).not.toContain("lucide");
    expect(markup).not.toContain(">Usage<");
  });
});
