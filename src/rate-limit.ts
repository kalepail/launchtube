import { RateLimiterDurableObject } from './rateLimiter'

export async function rateLimit(req: Request, env: Env): Promise<Response | void> {
    // Only enforce for POST /
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/') return;

    // Determine client IP
    const ip = req.headers.get('CF-Connecting-IP')
        || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'unknown';

    const id = env.RATE_LIMITER_DURABLE_OBJECT.idFromName(ip);
    const stub = env.RATE_LIMITER_DURABLE_OBJECT.get(id) as DurableObjectStub<RateLimiterDurableObject>;

    const result = await stub.check(Date.now());

    if (!result.allowed) {
        const retry = result.retryAfter ?? 1;
        return new Response(JSON.stringify({ error: 'Too many requests, please try again later.' }), {
            status: 429,
            headers: {
                'content-type': 'application/json',
                'retry-after': String(retry),
            }
        });
    }
}