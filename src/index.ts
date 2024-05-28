import { BASE_FEE } from "@stellar/stellar-sdk";
import { FeeBumpDurableObject } from "./feebump";
import { IttyRouter, RequestLike, cors, error, json, text, withParams } from 'itty-router'
import { verify, decode, sign } from '@tsndr/cloudflare-worker-jwt'

const MAX_U32 = 2 ** 32 - 1

const { preflight, corsify } = cors()
const router = IttyRouter()

router
	.options('*', preflight)
	.all('*', withParams)
	.get('/gen', async (request: RequestLike, env: Env, ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await env.SUDOS.get(token))
			return error(401, 'Unauthorized')

		const ttl = Number(request.query.ttl)
		const credits = Number(request.query.credits)
		
		let count = Number(request.query.count)

		if (
			!ttl
			|| Number.isNaN(ttl)
		) return error(400, `Invalid \`ttl\` key`)

		if (
			!credits
			|| Number.isNaN(credits)
		) return error(400, `Invalid \`credits\` key`)

		if (
			!count
			|| Number.isNaN(count)
			|| Number(count) > 100
		) return error(400, '`count` key must be <= 100')

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
	.get('/', async (request: RequestLike, env: Env, ctx: ExecutionContext) => {
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
	.post('/', async (request: RequestLike, env: Env, ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]
		const body = await request.formData()
		const xdr = body.get('xdr')?.toString()
		const fee = Number(body.get('fee')) ?? 100

		if (!xdr)
			return error(400, 'Missing `xdr` key')

		if (
			!fee
			|| Number.isNaN(fee)
			|| fee < Number(BASE_FEE)
			|| fee > MAX_U32
		) return error(400, `\`fee\` key must be >= ${BASE_FEE} and <= ${MAX_U32}`)

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