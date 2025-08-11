import { DurableObject } from "cloudflare:workers";

interface RateLimitData {
	requestCount: number;
	windowStart: number;
	backoffLevel: number;
	lastBackoffTime: number;
}

export class RateLimiterDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	/**
	 * Check if request should be rate limited
	 * Returns { allowed: boolean, remainingMs?: number }
	 */
	async checkRateLimit(): Promise<{ allowed: boolean; remainingMs?: number }> {
		const now = Date.now();
		const windowMs = Number(this.env.RATE_LIMIT_WINDOW_MS) || 60000; // Default 1 minute
		const maxRequests = Number(this.env.RATE_LIMIT_REQUESTS) || 10; // Default 10 requests
		const baseBackoffMs = Number(this.env.RATE_LIMIT_BACKOFF_BASE_MS) || 1000; // Default 1 second
		const backoffMultiplier = Number(this.env.RATE_LIMIT_BACKOFF_MULTIPLIER) || 2; // Default 2x
		const maxBackoffMs = Number(this.env.RATE_LIMIT_MAX_BACKOFF_MS) || 300000; // Default 5 minutes

		// Get current rate limit data
		let data = await this.ctx.storage.get<RateLimitData>('rateLimitData') || {
			requestCount: 0,
			windowStart: now,
			backoffLevel: 0,
			lastBackoffTime: 0
		};

		// Check if we're in a backoff period
		if (data.backoffLevel > 0) {
			const backoffTime = Math.min(baseBackoffMs * Math.pow(backoffMultiplier, data.backoffLevel - 1), maxBackoffMs);
			const backoffEnd = data.lastBackoffTime + backoffTime;
			
			if (now < backoffEnd) {
				// Still in backoff period
				return {
					allowed: false,
					remainingMs: backoffEnd - now
				};
			} else {
				// Backoff period ended, reset some values but keep reduced limits for gradual recovery
				data.backoffLevel = Math.max(0, data.backoffLevel - 1);
				data.requestCount = 0;
				data.windowStart = now;
			}
		}

		// Check if we need to reset the window
		if (now - data.windowStart >= windowMs) {
			data.requestCount = 0;
			data.windowStart = now;
		}

		// Check if we've exceeded the limit
		if (data.requestCount >= maxRequests) {
			// Increase backoff level and start backoff period
			data.backoffLevel++;
			data.lastBackoffTime = now;
			
			const backoffTime = Math.min(baseBackoffMs * Math.pow(backoffMultiplier, data.backoffLevel - 1), maxBackoffMs);
			
			await this.ctx.storage.put('rateLimitData', data);
			
			return {
				allowed: false,
				remainingMs: backoffTime
			};
		}

		// Allow request and increment counter
		data.requestCount++;
		await this.ctx.storage.put('rateLimitData', data);

		return { allowed: true };
	}

	/**
	 * Get current rate limit status for debugging
	 */
	async getStatus(): Promise<RateLimitData & { windowMs: number; maxRequests: number }> {
		const data = await this.ctx.storage.get<RateLimitData>('rateLimitData') || {
			requestCount: 0,
			windowStart: Date.now(),
			backoffLevel: 0,
			lastBackoffTime: 0
		};

		return {
			...data,
			windowMs: Number(this.env.RATE_LIMIT_WINDOW_MS) || 60000,
			maxRequests: Number(this.env.RATE_LIMIT_REQUESTS) || 10
		};
	}

	/**
	 * Reset rate limit data (for testing or admin purposes)
	 */
	async reset(): Promise<void> {
		await this.ctx.storage.delete('rateLimitData');
	}
}