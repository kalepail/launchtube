import { verify, decode } from "@tsndr/cloudflare-worker-jwt"
import { RequestLike, error, text } from "itty-router"
import { CreditsDurableObject } from "../credits"

export async function apiTokenInfo(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const token = request.headers.get('Authorization').split(' ')[1]

    if (!await verify(token, env.JWT_SECRET))
        return error(401, 'Unauthorized')

    const { payload } = decode(token)

    if (!payload?.sub)
        return error(401, 'Invalid')

    const id = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub)
    const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

    const info = await stub.info()

    return text(info)
}