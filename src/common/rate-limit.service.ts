import { Injectable } from '@nestjs/common';

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(key: string, options: RateLimitOptions = {}): RateLimitResult {
    const windowMs = options.windowMs ?? 10 * 60 * 1000;
    const max = options.max ?? 10;
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (bucket.count >= max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  private prune(now: number) {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
