# Rate Limiting

Launchtube implements IP-based rate limiting with exponential backoff for the `POST /` endpoint using Cloudflare Durable Objects.

## Features

- **IP-based rate limiting**: Each IP address has its own rate limit counter
- **Exponential backoff**: Violations trigger increasingly longer delays
- **Configurable limits**: All parameters can be adjusted via environment variables
- **Privacy-preserving**: IP addresses are hashed before storage
- **Gradual recovery**: Backoff levels decrease over time with good behavior

## Configuration

Rate limiting is configured via environment variables in `wrangler.toml`:

### Development Environment
```toml
RATE_LIMIT_REQUESTS = "10"           # 10 requests per window
RATE_LIMIT_WINDOW_MS = "60000"       # 60-second window
RATE_LIMIT_BACKOFF_BASE_MS = "1000"  # 1-second initial backoff
RATE_LIMIT_BACKOFF_MULTIPLIER = "2"  # Double backoff each violation
RATE_LIMIT_MAX_BACKOFF_MS = "300000" # 5-minute maximum backoff
```

### Production Environment
```toml
RATE_LIMIT_REQUESTS = "20"           # 20 requests per window
RATE_LIMIT_WINDOW_MS = "60000"       # 60-second window  
RATE_LIMIT_BACKOFF_BASE_MS = "2000"  # 2-second initial backoff
RATE_LIMIT_BACKOFF_MULTIPLIER = "2"  # Double backoff each violation
RATE_LIMIT_MAX_BACKOFF_MS = "600000" # 10-minute maximum backoff
```

## Behavior

### Normal Operation
- Up to 10 requests per minute (dev) or 20 requests per minute (prod) are allowed
- Requests within the limit receive normal responses
- Rate limit counters reset after each time window

### Rate Limiting Triggered
When the limit is exceeded:
1. HTTP 429 (Too Many Requests) is returned
2. `Retry-After` header indicates when to retry
3. Exponential backoff begins

### Exponential Backoff Progression
**Development (base: 1s, max: 5min):**
```
Violation 1: 1s delay
Violation 2: 2s delay  
Violation 3: 4s delay
Violation 4: 8s delay
Violation 5: 16s delay
...continuing until 5-minute maximum
```

**Production (base: 2s, max: 10min):**
```
Violation 1: 2s delay
Violation 2: 4s delay
Violation 3: 8s delay  
Violation 4: 16s delay
Violation 5: 32s delay
...continuing until 10-minute maximum
```

### Recovery
- Backoff levels gradually decrease with compliant behavior
- Complete reset occurs after successful compliance period
- Rate limit counters reset in each new time window

## Response Headers

Rate-limited responses include helpful headers:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 8
X-RateLimit-Limit: 10
X-RateLimit-Window: 60000
Content-Type: application/json

{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retryAfterSeconds": 8
}
```

## Testing

### Local Development Testing

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Run the simple test:
   ```bash
   node test-rate-limiting-simple.js
   ```

3. Run the comprehensive test suite:
   ```bash
   node test-rate-limiting.js
   ```

### Manual Testing

Send rapid POST requests to the root endpoint:

```bash
for i in {1..15}; do
  curl -X POST http://localhost:8787/ \
    -H "Authorization: Bearer YOUR_JWT_TOKEN" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "mock=xdr&sim=true"
  sleep 0.2
done
```

## Implementation Details

### Architecture
- **RateLimiterDurableObject**: Manages rate limit state per IP address
- **IP Hashing**: SHA-256 hash of IP + salt for privacy
- **Durable Storage**: Persistent rate limit counters across requests
- **Middleware**: Applied only to `POST /` endpoint as requested

### Files
- `src/rate-limiter.ts` - Durable Object implementation
- `src/rate-limit-helper.ts` - IP extraction and middleware logic
- `src/index.ts` - Integration with main router
- `test-rate-limiting.js` - Comprehensive test suite
- `test-rate-limiting-simple.js` - Quick test script

### Security Considerations
- IP addresses are hashed before storage for privacy
- Rate limiting is applied at the edge before expensive operations
- Configurable limits allow tuning for different environments
- Gradual recovery prevents permanent blocking of legitimate users

## Monitoring

Rate limiting events are logged for monitoring:

```javascript
console.log('Rate limited:', {
  hashedIP: 'abc123...',
  requestCount: 15,
  backoffLevel: 3,
  retryAfter: 8000
});
```

Consider monitoring 429 response rates to tune rate limiting parameters for your traffic patterns.