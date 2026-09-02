interface WindowEntry {
  timestamps: number[]
  lastSeenAt: number
}

export interface RateLimitRule {
  limit: number
  windowMs: number
}

export interface RateLimitDecision {
  allowed: boolean
  retryAfterMs: number
  remaining: number
}

/**
 * Exact sliding-window limiter for the initial single-process deployment.
 * Replace it with a Redis-backed implementation before adding server replicas.
 */
export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>()
  private operations = 0

  consume(key: string, rule: RateLimitRule, now = Date.now()): RateLimitDecision {
    if (rule.limit <= 0 || rule.windowMs <= 0) throw new Error("Rate-limit rules must be positive")
    const cutoff = now - rule.windowMs
    const entry = this.entries.get(key) ?? { timestamps: [], lastSeenAt: now }
    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > cutoff)
    entry.lastSeenAt = now

    if (entry.timestamps.length >= rule.limit) {
      this.entries.set(key, entry)
      this.maybeSweep(now)
      return {
        allowed: false,
        retryAfterMs: Math.max(1, entry.timestamps[0] + rule.windowMs - now),
        remaining: 0,
      }
    }

    entry.timestamps.push(now)
    this.entries.set(key, entry)
    this.maybeSweep(now)
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: Math.max(0, rule.limit - entry.timestamps.length),
    }
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  private maybeSweep(now: number): void {
    this.operations += 1
    if (this.operations % 1_000 !== 0) return
    const staleBefore = now - 10 * 60_000
    for (const [key, entry] of this.entries) {
      if (entry.lastSeenAt < staleBefore) this.entries.delete(key)
    }
  }
}
