import { RequestLike, error, text } from "itty-router";
import { CreditsDurableObject } from "../credits";

export async function apiTokenDelete(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    const token = request.headers.get('Authorization').split(' ')[1]

    if (!await env.SUDOS.get(token))
        return error(401, 'Unauthorized')

    const id = env.CREDITS_DURABLE_OBJECT.idFromString(request.params.sub)
    const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

    await stub.delete()

    return text('OK')
}