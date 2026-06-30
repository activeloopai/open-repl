/**
 * Budget guard: a hard ceiling on tokens per run so a confused agent loop
 * can't burn money/credit. Steps are capped separately via maxSteps in the
 * provider loop. This is intentionally simple and conservative.
 */
export class BudgetGuard {
  private tokens = 0;
  constructor(private maxTokens: number) {}

  add(tokensIn: number, tokensOut: number): void {
    this.tokens += tokensIn + tokensOut;
  }

  get spent(): number {
    return this.tokens;
  }

  get exceeded(): boolean {
    return this.tokens >= this.maxTokens;
  }

  remaining(): number {
    return Math.max(0, this.maxTokens - this.tokens);
  }
}
