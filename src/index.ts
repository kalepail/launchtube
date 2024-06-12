import { xdr, BASE_FEE, Keypair, Operation, StrKey, TransactionBuilder, Transaction } from "@stellar/stellar-base";
import { CreditsDurableObject } from "./credits";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, RequestLike, cors, error, json, text, withParams } from 'itty-router'
import { verify, decode, sign } from '@tsndr/cloudflare-worker-jwt'
import { object, preprocess, number, string, array, ZodIssueCode } from "zod";
import { getAccount, networkPassphrase, sendTransaction, simulateTransaction } from "./common";
import { getMockOp } from "./helpers";
import { StatusError } from "itty-fetcher";

const MAX_U32 = 2 ** 32 - 1
const SEQUENCER_ID_NAME = 'stellaristhebetterblockchain'

const { preflight, corsify } = cors()
const router = IttyRouter()

/* TODO 
	- Clean up the old feebump logic
		Rename entire repo
	- Likely need some rate limiting around here
		Throttle on dupe params
		Throttle on sequence creation
	- Probably need to move to a queue system and polling so we don’t have to keep connections open for submissions that may take awhile to get through during times of high throughput
		This probably makes the whole system a bit more resilient
*/

router
	.options('*', preflight)
	.all('*', withParams)
	.post('/', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await verify(token, env.JWT_SECRET))
			return error(401, 'Unauthorized')

		const { payload } = decode(token)

		if (!payload?.sub)
			return error(401, 'Invalid')

		let res: any
		let credits: number
		let sequencerId: DurableObjectId
		let sequencerStub: DurableObjectStub<SequencerDurableObject> | undefined
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

			sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
			sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;
			sequenceSecret = await sequencerStub.getSequence()

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
				/* NOTE 
					- This doesn't copy the op source which may break auth scenarios which borrow from the tx or op source
						This is done as a safety precaution to ensure you can never use the system provided sequence account in your auth entries
						It's possible we could ease up on this in the future with some careful checking
						We could probably snipe the tx source if `xdr` was the arg and use it for the op source as well as any provided auth source itself
							We'd just need to ensure the source wasn't a system provided sequence account
				*/
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
			/* NOTE 
				Divided by 2 as a workaround to my workaround solution where TransactionBuilder.buildFeeBumpTransaction tries to be smart about the op base fee
				Note the fee is also part of the divide by 2 which means this will be the max in addition to the resource fee you'll pay for both the inner fee and the fee-bump combined
				https://github.com/stellar/js-stellar-base/issues/749
				https://github.com/stellar/js-stellar-base/compare/master...inner-fee-fix
				https://discord.com/channels/897514728459468821/1245935726424752220
			*/
			const feeBumpFee = (BigInt(fee) + resourceFee) / 2n

			transaction = TransactionBuilder
				.cloneFrom(transaction, {
					fee: resourceFee.toString(), // NOTE inner tx fee cannot be less than the resource fee or the tx will be invalid
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

			const creditsId = env.CREDITS_DURABLE_OBJECT.idFromString(payload.sub)
			const creditsStub = env.CREDITS_DURABLE_OBJECT.get(creditsId) as DurableObjectStub<CreditsDurableObject>;

			credits = await creditsStub.spend(
				Number(feeBumpTransaction.fee),
				feeBumpTransaction.hash().toString('hex')
			)

			res = await sendTransaction(feeBumpTransaction.toXDR())
		} finally {
			// if this fails we'd lose the sequence keypair. Fine because sequences are derived and thus re-discoverable
			if (sequencerStub && sequenceSecret)
				await sequencerStub.returnSequence(sequenceSecret)
		}

		return json(res, {
			headers: {
				'X-Credits-Remaining': credits,
			}
		})
	})
	.get('/seq', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		if (env.ENV !== 'development') { // TODO DRY out Authorization checks
			const token = request.headers.get('Authorization').split(' ')[1]

			if (!await env.SUDOS.get(token))
				return error(401, 'Unauthorized')
		}

		const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
		const sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;

		return json(await sequencerStub.getData())
	})
	.get('/gen', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		if (env.ENV !== 'development') {
			const token = request.headers.get('Authorization').split(' ')[1]

			if (!await env.SUDOS.get(token))
				return error(401, 'Unauthorized')
		}

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
	})
	.get('/', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
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
	})
	.delete('/:sub', async (request: RequestLike, env: Env, _ctx: ExecutionContext) => {
		const token = request.headers.get('Authorization').split(' ')[1]

		if (!await env.SUDOS.get(token))
			return error(401, 'Unauthorized')

		const id = env.CREDITS_DURABLE_OBJECT.idFromString(request.params.sub)
		const stub = env.CREDITS_DURABLE_OBJECT.get(id) as DurableObjectStub<CreditsDurableObject>;

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
				throw err
			})
			.catch(error)
			.then((r) => corsify(r, request))
}

export {
	SequencerDurableObject,
	CreditsDurableObject,
	handler as default
}