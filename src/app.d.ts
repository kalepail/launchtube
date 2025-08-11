interface Env {
	RPC_URLS: string // (string | [string, string])[];

	RATE_LIMITER_DURABLE_OBJECT: DurableObjectNamespace<RateLimiterDurableObject>;

	RATE_LIMIT_ENABLED?: string | boolean;
	RATE_LIMIT_MAX_REQUESTS?: string; // number as string
	RATE_LIMIT_WINDOW_MS?: string; // number as string
	RATE_LIMIT_BACKOFF_BASE_MS?: string; // number as string
	RATE_LIMIT_BACKOFF_FACTOR?: string; // number as string
	RATE_LIMIT_BACKOFF_MAX_MS?: string; // number as string
}
