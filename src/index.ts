import { xdr, BASE_FEE, Keypair, Operation, StrKey, TransactionBuilder, Transaction } from "@stellar/stellar-base";
import { FeeBumpDurableObject } from "./feebump";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, RequestLike, cors, error, json, text, withParams } from 'itty-router'
import { verify, decode, sign } from '@tsndr/cloudflare-worker-jwt'
import { object, preprocess, number, string, array, union, ZodIssueCode } from "zod";
import { getAccount, networkPassphrase, sendTransaction, simulateTransaction } from "./common";
import { getMockOp } from "./helpers";

const MAX_U32 = 2 ** 32 - 1

const { preflight, corsify } = cors()
const router = IttyRouter()

/* TODO 
	- Clean up the old feebump logic
		Remove old DO
		Rename entire repo
	- Likely need some rate limiting around here
	- Still hitting issues during loadtest
*/

router
	.options('*', preflight)
	.all('*', withParams)
	.all('/seq/:command', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const id = env.SEQUENCER_DURABLE_OBJECT.idFromName('hello world');
		const stub = env.SEQUENCER_DURABLE_OBJECT.get(id) as DurableObjectStub<SequencerDurableObject>;

		switch (request.params.command) {
			case 'getSequence':
				let res: any
				let sequenceSecret: string | undefined

				try {
					const formData = await request.formData()
					const mock = formData.get('mock')
					const isMock = ['true', 'xdr', 'op'].includes(mock)
					const debug = formData.get('debug') === 'true'

					const schema = object({
						xdr: string().optional(),
						func: string().optional(),
						auth: preprocess(
							(val) => val ? JSON.parse(val as string) : undefined,
							array(string()).optional()
						),
						fee: preprocess(Number, number().gte(Number(BASE_FEE)).lte(MAX_U32)),
					}).superRefine((input, ctx) => {
						if (!input.xdr && !input.func && !input.auth)
							ctx.addIssue({
								code: ZodIssueCode.custom,
								message: 'Must pass either `xdr` or `func` and `auth`'
							})
						else if (input.xdr && (input.func || input.auth))
							ctx.addIssue({
								code: ZodIssueCode.custom,
								message: '`func` and `auth` must be omitted when passing `xdr`'
							})
						else if (!input.xdr && !(input.func && input.auth))
							ctx.addIssue({
								code: ZodIssueCode.custom,
								message: '`func` and `auth` are both required when omitting `xdr`'
							})
					})

					const {
						xdr: x,
						func: f,
						auth: a,
						fee,
					} = schema.parse(
						isMock && env.ENV === 'development' 
							? await getMockOp(mock) // Only ever mock in development
							: Object.fromEntries(formData)
					)

					let transaction

					if (debug)
						return json({ xdr: x, func: f, auth: a, fee })

					sequenceSecret = await stub.getSequence()

					const sequenceKeypair = Keypair.fromSecret(sequenceSecret)
					const sequencePubkey = sequenceKeypair.publicKey()
					const sequenceSource = await getAccount(sequencePubkey)

					let func: xdr.HostFunction
					let auth: xdr.SorobanAuthorizationEntry[] | undefined

					// Passing `xdr`
					if (x) {
						const op = new Transaction(x, networkPassphrase).operations[0] as Operation.InvokeHostFunction

						func = op.func
						auth = op.auth
					} 
					
					// Passing `func` and `auth`
					else if (f && a) {
						func = xdr.HostFunction.fromXDR(f, 'base64')
						auth = a?.map((auth) => xdr.SorobanAuthorizationEntry.fromXDR(auth, 'base64'))
					}

					else
						throw 'Invalid request'

					const invokeContract = func.invokeContract()
					const contract = StrKey.encodeContract(invokeContract.contractAddress().contractId())

					transaction = new TransactionBuilder(sequenceSource, {
						fee: '0',
						networkPassphrase
					})
						.addOperation(Operation.invokeContractFunction({
							contract,
							function: invokeContract.functionName().toString(),
							args: invokeContract.args(),
							auth
						}))
						.setTimeout(5 * 60)
						.build()

					transaction.sign(sequenceKeypair)

					const sim = await simulateTransaction(transaction.toXDR())

					/* TODO 
						- Should we check that we have the right auth? Might be a fools errand if simulation can't catch it
							I think we can review the included results[0].auth array and ensure it's been entirely included in the transaction we're about to submit
					*/

					const sorobanData = xdr.SorobanTransactionData.fromXDR(sim.transactionData, 'base64')
					const resourceFee = sorobanData.resourceFee().toBigInt()
					const feeBumpFee = (BigInt(fee) + resourceFee) / 2n // bit of jank for the way `buildFeeBumpTransaction` works with multiplying the fee by ((number of ops + 1) * fee)

					transaction = TransactionBuilder
						.cloneFrom(transaction, {
							fee: resourceFee.toString(), // inner tx fee cannot be less than the resource fee or the tx will be invalid
							sorobanData
						})
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

					res = await sendTransaction(feeBumpTransaction.toXDR())
				} finally {
					// if this fails we'd lose the sequence keypair. Fine because sequences are derived and thus re-discoverable
					if (sequenceSecret)
						await stub.returnSequence(sequenceSecret)
				}

				return json(res)
			case 'getData':
				return json(await stub.getData())
			default:
				return error(404)
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
			.catch((err) => {
				console.error(err)
				return error(400, err)
			})
			.then((r) => corsify(r, request))
}

export {
	SequencerDurableObject,
	FeeBumpDurableObject,
	handler as default
}