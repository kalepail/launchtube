import { xdr, Account, BASE_FEE, Keypair, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-base";
import { FeeBumpDurableObject } from "./feebump";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, RequestLike, cors, error, json, text, withParams } from 'itty-router'
import { verify, decode, sign } from '@tsndr/cloudflare-worker-jwt'
import { object, preprocess, number, string, array } from "zod";
import { horizon, networkPassphrase, rpc } from "./common";
import { getMockOp } from "./helpers";

const MAX_U32 = 2 ** 32 - 1

const { preflight, corsify } = cors()
const router = IttyRouter()

router
	.options('*', preflight)
	.all('*', withParams)
	.all('/seq/:command', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const id = env.SEQUENCER_DURABLE_OBJECT.idFromName('hello world');
		const stub = env.SEQUENCER_DURABLE_OBJECT.get(id) as DurableObjectStub<SequencerDurableObject>;

		try {
			switch (request.params.command) {
				case 'getSequence':
					let sequenceSecret: string | undefined

					try {
						const formData = await request.formData()
						const mock = formData.get('mock') === 'true'
						const debug = formData.get('debug') === 'true'

						const body = object({
							func: string(),
							auth: preprocess(
								(val) => val ? JSON.parse(val as string) : undefined,
								array(string())
							),
							fee: preprocess(Number, number().gte(Number(BASE_FEE)).lte(MAX_U32)),
						});

						const {
							func: f,
							auth: a,
							fee,
						} = body.parse(
								mock
								? await getMockOp()
								: Object.fromEntries(formData)
						)

						if (debug)
							return json({func: f, auth: a, fee})

						const func = xdr.HostFunction.fromXDR(f, 'base64')
						const auth = a?.map((auth) => xdr.SorobanAuthorizationEntry.fromXDR(auth, 'base64'))

						sequenceSecret = await stub.getSequence()

						const sequenceKeypair = Keypair.fromSecret(sequenceSecret)
						const sequencePubkey = sequenceKeypair.publicKey()
						const sequenceSource: any = await horizon.get(`/accounts/${sequencePubkey}`).then((res: any) => new Account(res.id, res.sequence))

						let transaction = new TransactionBuilder(sequenceSource, {
							fee: '0',
							networkPassphrase
						})
							.addOperation(Operation.invokeContractFunction({
								contract: StrKey.encodeContract(func.invokeContract().contractAddress().contractId()),
								function: func.invokeContract().functionName().toString(),
								args: func.invokeContract().args(),
								auth
							}))
							.setTimeout(5 * 60)
							.build()

						transaction.sign(sequenceKeypair)

						const sim = await rpc.post('/', {
							jsonrpc: '2.0',
							id: 8891,
							method: 'simulateTransaction',
							params: {
								transaction: transaction.toXDR()
							}
						}).then((res: any) => {
							if (res.result.error) // TODO handle state archival 
								throw res.result

							return res.result
						})

						const sorobanData = xdr.SorobanTransactionData.fromXDR(sim.transactionData, 'base64')
						const resourceFee = sorobanData.resourceFee().toBigInt()
						const feeBumpFee = (BigInt(fee) + resourceFee) / 2n

						transaction = TransactionBuilder
							.cloneFrom(transaction, {
								fee: resourceFee.toString()
							})
							.setSorobanData(sorobanData)
							.build()

						transaction.sign(sequenceKeypair)

						const sourceKeypair = Keypair.fromSecret(env.FEEBUMP_SK)
						const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
							sourceKeypair,
							feeBumpFee.toString(),
							transaction,
							networkPassphrase
						)

						feeBumpTransaction.sign(sourceKeypair)

						const data = new FormData()

						data.set('tx', feeBumpTransaction.toXDR())

						const res = await horizon.post('/transactions', data)

						return json(res)
					} finally {
						// TODO if this fails we'd lose the sequence keypair. We should be storing these in a KV I think

						if (sequenceSecret)
							await stub.returnSequence(sequenceSecret)
					}
				case 'getData':
					const keys = [...(await stub.getData())]

					return json({
						count: keys.length,
						keys
					})
				default:
					return error(404)
			}
		} catch (err: any) {
			console.error(err);
			return error(400, err)
		}
	})
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
			fee: preprocess(Number, number().gte(Number(BASE_FEE)).lte(Number(MAX_U32))),
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
	SequencerDurableObject,
	FeeBumpDurableObject,
	handler as default
}