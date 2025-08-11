import { DurableObject } from "cloudflare:workers";

interface State {
    count: number;
    reset: number;
    backoff: number;
}

export class RateLimitDurableObject extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async fetch(_request: Request) {
        const limit = Number(this.env.RATE_LIMIT_MAX || 0);
        const windowMs = Number(this.env.RATE_LIMIT_WINDOW || 0) * 1000;
        const now = Date.now();
        let state = await this.ctx.storage.get<State>("state");
        if (!state || now > state.reset) {
            state = { count: 0, reset: now + windowMs, backoff: 0 };
        }

        state.count += 1;
        if (state.count <= limit) {
            await this.ctx.storage.put("state", state);
            return new Response(null, { status: 200 });
        }

        state.backoff += 1;
        state.reset = now + windowMs * (2 ** (state.backoff - 1));
        await this.ctx.storage.put("state", state);
        const retry = Math.ceil((state.reset - now) / 1000);
        return new Response(String(retry), { status: 429 });
    }
}
