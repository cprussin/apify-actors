/**
 * Own tally of pay-per-event charges vs. ACTOR_MAX_TOTAL_CHARGE_USD, as a
 * second guard next to the SDK's eventChargeLimitReached flag.
 */
export class Budget {
  spent = 0;

  constructor(
    private readonly maxUsd: number,
    private readonly prices: Record<string, number>,
  ) {}

  /** Whether one more `event` fits in the budget. */
  canAfford(event: string): boolean {
    const p = this.prices[event] ?? 0;
    return this.spent + p <= this.maxUsd + 1e-9;
  }

  /** Records a charge; returns whether another event of this kind still fits. */
  charge(event: string): boolean {
    this.spent += this.prices[event] ?? 0;
    return this.canAfford(event);
  }
}
