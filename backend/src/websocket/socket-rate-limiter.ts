/** Per-socket token bucket. A socket lives on one process, so local state is correct here. */
export class SocketRateLimiter {
  private tokens: number;
  private updatedAt: number;
  rejected = 0;

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.updatedAt = now();
  }

  take(): boolean {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.updatedAt) / 1000) * this.perSecond);
    this.updatedAt = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.rejected += 1;
    return false;
  }
}
