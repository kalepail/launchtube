import { DurableObject } from "cloudflare:workers";

export class RateLimiterDurableObject extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    public async check(nowMs?: number) {
        const now = typeof nowMs === 'number' ? nowMs : Date.now();

        const enabled = (this.env.RATE_LIMIT_ENABLED ?? 'true').toString().toLowerCase() === 'true';
        if (!enabled) {
            return { allowed: true } as const;
        }

        const maxRequests = parseInt(this.env.RATE_LIMIT_MAX_REQUESTS ?? '30', 10);
        const windowMs = parseInt(this.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
        const backoffBaseMs = parseInt(this.env.RATE_LIMIT_BACKOFF_BASE_MS ?? '1000', 10);
        const backoffFactor = parseFloat(this.env.RATE_LIMIT_BACKOFF_FACTOR ?? '2');
        const backoffMaxMs = parseInt(this.env.RATE_LIMIT_BACKOFF_MAX_MS ?? '600000', 10);

        let blockedUntil = (await this.ctx.storage.get<number>('blockedUntil')) || 0;
        if (now < blockedUntil) {
            const retryAfter = Math.ceil((blockedUntil - now) / 1000);
            return { allowed: false, retryAfter } as const;
        }

        let windowStart = (await this.ctx.storage.get<number>('windowStart')) || now;
        let count = (await this.ctx.storage.get<number>('count')) || 0;
        let violations = (await this.ctx.storage.get<number>('violations')) || 0;

        if (now - windowStart >= windowMs) {
            windowStart = now;
            count = 0;
            if (violations > 0) violations = violations - 1;
        }

        if (count + 1 <= maxRequests) {
            count = count + 1;
            await this.ctx.storage.put('count', count);
            await this.ctx.storage.put('windowStart', windowStart);
            await this.ctx.storage.delete('blockedUntil');
            await this.ctx.storage.put('violations', violations);
            return { allowed: true } as const;
        }

        violations = violations + 1;
        const backoff = Math.min(Math.floor(backoffBaseMs * Math.pow(backoffFactor, violations - 1)), backoffMaxMs);
        blockedUntil = now + backoff;

        await this.ctx.storage.put('blockedUntil', blockedUntil);
        await this.ctx.storage.put('violations', violations);
        await this.ctx.storage.put('windowStart', windowStart);
        await this.ctx.storage.put('count', count);

        const retryAfter = Math.ceil(backoff / 1000);
        return { allowed: false, retryAfter } as const;
    }
}