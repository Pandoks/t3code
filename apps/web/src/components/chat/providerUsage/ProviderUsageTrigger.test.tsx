import { ProviderDriverKind } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderUsageTrigger } from "./ProviderUsageTrigger";

describe("ProviderUsageTrigger", () => {
  it("renders a compact icon-only Codex-colored usage control", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageTrigger
        providerDriver={ProviderDriverKind.make("codex")}
        providerDisplayName="Codex Work"
        expanded={false}
        remainingLevels={[49, 100]}
      />,
    );

    expect(markup).toContain('aria-label="Codex Work provider usage"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("size-6");
    expect(markup).toContain("#49A3B0");
    expect(markup).toContain("border-transparent");
    expect(markup).toContain("hover:bg-accent");
    expect(markup).toContain("rounded-full");
    expect(markup).not.toContain("border-color");
    expect(markup).not.toContain("background-color");
    expect(markup).toContain('data-provider-usage-glyph="true"');
    expect(markup).toContain('data-provider-usage-track="primary"');
    expect(markup).toContain('data-provider-usage-fill="primary"');
    expect(markup).toContain('width="4.9"');
    expect(markup).toContain('data-provider-usage-fill="secondary"');
    expect(markup).toContain('width="10"');
    expect(markup).not.toContain("lucide");
    expect(markup).not.toContain(">Usage<");
  });

  it("renders only one meter row when given one level", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageTrigger
        providerDriver={ProviderDriverKind.make("codex")}
        providerDisplayName="Codex"
        expanded={false}
        remainingLevels={[47]}
      />,
    );

    expect(markup).toContain('data-provider-usage-fill="primary"');
    expect(markup).not.toContain('data-provider-usage-fill="secondary"');
  });

  it("uses the active Claude color for a Claude chat", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsageTrigger
        providerDriver={ProviderDriverKind.make("claudeAgent")}
        providerDisplayName="Claude"
        expanded={false}
        remainingLevels={[75, 67]}
      />,
    );

    expect(markup).toContain("#D97757");
    expect(markup).not.toContain("#49A3B0");
  });
});
