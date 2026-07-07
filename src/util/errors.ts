/**
 * A business-rule refusal (oversell, below-cost, duplicate, invalid input, …).
 * Thrown from the tool/repo layer and relayed to the owner as a plain message —
 * this is how guardrails are ENFORCED where the data changes, not in the prompt.
 */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}
