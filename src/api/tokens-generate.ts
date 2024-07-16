import { RequestLike, error, json } from "itty-router";
import { object, preprocess, number } from "zod";
import { CreditsDurableObject } from "../credits";
import { sign } from "@tsndr/cloudflare-worker-jwt";

export async function apiTokensGenerate(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    let ttl, credits, count;

    if (env.ENV === 'development') {
        ttl = 31_536_000
        credits = 1_000_000_000
        count = 1
    } else {
        const token = request.headers.get('Authorization').split(' ')[1]

        if (!await env.SUDOS.get(token))
            return error(401, 'Unauthorized')

        const body = object({
            ttl: preprocess(Number, number()),
            credits: preprocess(Number, number()),
            count: preprocess(Number, number().gte(1).lte(100)),
        }).parse(request.query)
    
        ttl = body.ttl
        credits = body.credits
        count = body.count
    }

    const tokens = []

    while (count--) {
        const id = env.CREDITS_DURABLE_OBJECT.newUniqueId();
        const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;
        const token = await sign({
            sub: id.toString(),
            exp: Math.floor((Date.now() + ttl * 1000) / 1000)
        }, env.JWT_SECRET)

        await stub.init(ttl, credits);

        tokens.push(token)
    }

    return json(tokens)
}