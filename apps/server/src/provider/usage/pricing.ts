export interface ClaudeUsageForPricing {
  readonly date?: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly cacheCreation5mTokens: number;
  readonly cacheCreation1hTokens: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
}

interface ClaudeModelPrice {
  readonly input: number;
  readonly output: number;
}

const CLAUDE_MODEL_PRICES_PER_MILLION: ReadonlyArray<{
  readonly matches: RegExp;
  readonly price: ClaudeModelPrice;
}> = [
  { matches: /^claude-(?:fable|mythos)-5(?:-|$)/, price: { input: 10, output: 50 } },
  { matches: /^claude-opus-4-(?:5|6|7|8)(?:-|$)/, price: { input: 5, output: 25 } },
  { matches: /^claude-sonnet-4-(?:5|6)(?:-|$)/, price: { input: 3, output: 15 } },
  { matches: /^claude-haiku-4-5(?:-|$)/, price: { input: 1, output: 5 } },
];

export function estimateClaudeUsageCostUsd(input: ClaudeUsageForPricing): number | null {
  const price = /^claude-sonnet-5(?:-|$)/.test(input.model)
    ? input.date === undefined
      ? undefined
      : input.date <= "2026-08-31"
        ? { input: 2, output: 10 }
        : { input: 3, output: 15 }
    : CLAUDE_MODEL_PRICES_PER_MILLION.find(({ matches }) => matches.test(input.model))?.price;
  if (!price) return null;

  const cost =
    input.inputTokens * price.input +
    input.cacheCreation5mTokens * price.input * 1.25 +
    input.cacheCreation1hTokens * price.input * 2 +
    input.cacheReadTokens * price.input * 0.1 +
    input.outputTokens * price.output;
  return cost / 1_000_000;
}
