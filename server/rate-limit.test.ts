import { describe, expect, it } from "vitest"

import { SlidingWindowRateLimiter } from "./rate-limit"

describe("SlidingWindowRateLimiter", () => {
  it("returns an exact retry delay and frees capacity at the window boundary", () => {
    const limiter = new SlidingWindowRateLimiter()
    const rule = { limit: 2, windowMs: 1_000 }

    expect(limiter.consume("player:action", rule, 1_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 1,
    })
    expect(limiter.consume("player:action", rule, 1_250)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 0,
    })
    expect(limiter.consume("player:action", rule, 1_500)).toEqual({
      allowed: false,
      retryAfterMs: 500,
      remaining: 0,
    })
    expect(limiter.consume("player:action", rule, 1_999).retryAfterMs).toBe(1)
    expect(limiter.consume("player:action", rule, 2_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 0,
    })
  })

  it("isolates keys and allows an explicit key reset", () => {
    const limiter = new SlidingWindowRateLimiter()
    const rule = { limit: 1, windowMs: 5_000 }

    expect(limiter.consume("player-a", rule, 100).allowed).toBe(true)
    expect(limiter.consume("player-a", rule, 101).allowed).toBe(false)
    expect(limiter.consume("player-b", rule, 101).allowed).toBe(true)

    limiter.delete("player-a")
    expect(limiter.consume("player-a", rule, 102)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 0,
    })
  })

  it("fails closed for invalid rules", () => {
    const limiter = new SlidingWindowRateLimiter()

    expect(() => limiter.consume("key", { limit: 0, windowMs: 1_000 }, 0)).toThrow(
      "Rate-limit rules must be positive",
    )
    expect(() => limiter.consume("key", { limit: 1, windowMs: 0 }, 0)).toThrow(
      "Rate-limit rules must be positive",
    )
  })
})
