import { BASE_FEE } from "@stellar/stellar-base";
import { FeeBumpDurableObject } from "./feebump";
import { IttyRouter, RequestLike, cors, error, json, text, withParams } from 'itty-router'
import { verify, decode, sign } from '@tsndr/cloudflare-worker-jwt'
import { object, preprocess, number, string, array } from "zod";

const MAX_U32 = 2 ** 32 - 1

const { preflight, corsify } = cors()
const router = IttyRouter()

// TODO consider adding an endpoint to create sequence accounts

router
	.options('*', preflight)
	.all('*', withParams)
	.get('/gen', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
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
			const id = env.FEEBUMP_DURABLE_OBJECT.newUniqueId();
			const stub = env.FEEBUMP_DURABLE_OBJECT.get(id) as DurableObjectStub<FeeBumpDurableObject>;
			const token = await sign({
				sub: id.toString(),
				exp: Math.floor((Date.now() + ttl * 1000) / 1000) // ~6 months, 26 weeks 
			}, env.JWT_SECRET)

			await stub.init(ttl, credits);

			tokens.push(token)
		}

		return json(tokens)
	})
	.get('/', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await verify(token, env.JWT_SECRET))
			return error(401, 'Unauthorized')

		const { payload } = decode(token)

		if (!payload?.sub)
			return error(401, 'Invalid')

		const id = env.FEEBUMP_DURABLE_OBJECT.idFromString(payload.sub)
		const stub = env.FEEBUMP_DURABLE_OBJECT.get(id) as DurableObjectStub<FeeBumpDurableObject>;

		const info = await stub.info()

		return text(info)
	})
	.post('/', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		const body = object({
			xdr: string(),
			fee: preprocess(Number, number().gte(Number(BASE_FEE)).lte(MAX_U32)),
		});

		const { xdr, fee } = body.parse(Object.fromEntries(await request.formData()))

		if (!await verify(token, env.JWT_SECRET))
			return error(401, 'Unauthorized')

		const { payload } = decode(token)

		if (!payload?.sub)
			return error(401, 'Invalid')

		const id = env.FEEBUMP_DURABLE_OBJECT.idFromString(payload.sub)
		const stub = env.FEEBUMP_DURABLE_OBJECT.get(id) as DurableObjectStub<FeeBumpDurableObject>;
		const { tx, credits } = await stub.bump(xdr, fee);

		return text(tx, {
			headers: {
				'X-Credits-Remaining': credits,
			}
		});
	})
	.delete('/:sub', async (request: RequestLike, env: Env, ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await env.SUDOS.get(token))
			return error(401, 'Unauthorized')

		const id = env.FEEBUMP_DURABLE_OBJECT.idFromString(request.params.sub)
		const stub = env.FEEBUMP_DURABLE_OBJECT.get(id) as DurableObjectStub<FeeBumpDurableObject>;

		await stub.delete()

		return text('OK')
	})
	.post('/sql', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await env.SUDOS.get(token))
			return error(401, 'Unauthorized')

		const body = object({
			query: string(),
			args: preprocess(
				(val) => val ? JSON.parse(val as string) : undefined,
				array(string()).optional()
			)
		});

		let { query, args } = body.parse(Object.fromEntries(await request.formData()))

		let results = []

		if (args) {
			const { results: r } = await env.DB.prepare(query)
				.bind(...args)
				.all();

			results = r
		} else {
			const { results: r } = await env.DB.prepare(query)
				.all();

			results = r
		}

		return json(results)
	})
	.all('*', () => error(404))

const handler = {
	fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
		router
			.fetch(request, env, ctx)
			.catch(error)
			.then((r) => corsify(r, request))
}

export {
	FeeBumpDurableObject,
	handler as default
}