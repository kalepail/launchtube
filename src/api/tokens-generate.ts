import { RequestLike, error, json } from "itty-router";
import { object, preprocess, number } from "zod";
import { CreditsDurableObject } from "../credits";
import { sign } from "@tsndr/cloudflare-worker-jwt";

export async function apiTokensGenerate(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const token = request.headers.get('Authorization').split(' ')[1]

    if (!await env.SUDOS.get(token))
        return error(401, 'Unauthorized')

    const body = object({
        ttl: preprocess(Number, number()),
        credits: preprocess(Number, number()),
        count: preprocess(Number, number().gte(1).lte(100)),
    });

    let { ttl, credits, count } = body.parse(request.query)

    const tokens = []

    while (count--) {
        const id = env.CREDITS_DURABLE_OBJECT.newUniqueId();
        const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;
        const token = await sign({
            sub: id.toString(),
            exp: Math.floor((Date.now() + ttl * 1000) / 1000) // ~6 months, 26 weeks 
        }, env.JWT_SECRET)

        await stub.init(ttl, credits);

        tokens.push(token)
    }

    return json(tokens)
}