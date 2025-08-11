import { RateLimiterDurableObject } from "./rate-limiter";
import { error } from "itty-router";

/**
 * Get IP address from request, handling Cloudflare headers
 */
export function getClientIP(request: Request): string {
    // Cloudflare provides real IP in CF-Connecting-IP header
    const cfIP = request.headers.get('CF-Connecting-IP');
    if (cfIP) return cfIP;
    
    // Fallback to X-Forwarded-For
    const forwardedFor = request.headers.get('X-Forwarded-For');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    
    // Fallback to X-Real-IP
    const realIP = request.headers.get('X-Real-IP');
    if (realIP) return realIP;
    
    // Default fallback (should rarely be used in Cloudflare)
    return '0.0.0.0';
}

/**
 * Hash IP address for privacy and to create consistent DO ID
 */
export async function hashIP(ip: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(ip + 'rate-limit-salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Rate limiting middleware for routes
 */
export async function checkRateLimit(
    request: Request, 
    env: Env
): Promise<Response | null> {
    try {
        const clientIP = getClientIP(request);
        const hashedIP = await hashIP(clientIP);
        
        // Create rate limiter DO instance for this IP
        const rateLimiterId = env.RATE_LIMITER_DURABLE_OBJECT.idFromString(hashedIP);
        const rateLimiterStub = env.RATE_LIMITER_DURABLE_OBJECT.get(rateLimiterId) as DurableObjectStub<RateLimiterDurableObject>;
        
        const result = await rateLimiterStub.checkRateLimit();
        
        if (!result.allowed) {
            const retryAfterSeconds = Math.ceil((result.remainingMs || 0) / 1000);
            
            return error(429, {
                error: 'Rate limit exceeded',
                message: 'Too many requests. Please try again later.',
                retryAfterSeconds,
            }, {
                'Retry-After': retryAfterSeconds.toString(),
                'X-RateLimit-Limit': env.RATE_LIMIT_REQUESTS || '10',
                'X-RateLimit-Window': env.RATE_LIMIT_WINDOW_MS || '60000',
            });
        }
        
        return null; // Allow request to proceed
    } catch (err) {
        console.error('Rate limit check failed:', err);
        // In case of error, allow request to proceed to avoid false positives
        return null;
    }
}